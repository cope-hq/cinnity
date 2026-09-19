import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import {
  validateUrl,
  referenceUrl,
  publicAddress,
  createFetcher,
  pinnedOptions,
  requestPinned,
  readCapped,
  META_CAP,
  IMAGE_CAP,
  AV_CAP,
} from '../src/network.js';

const signal = () => AbortSignal.timeout(1000);
export function response(statusCode = 200, headers = {}, chunks = ['<title>Example</title>']) {
  return Object.assign(Readable.from(chunks.map((c) => Buffer.from(c))), {
    statusCode,
    headers,
  });
}

test('arbitrary public HTTPS hostname URL policy', () => {
  assert.equal(validateUrl('https://pages.example:443/a#fragment').href, 'https://pages.example/a');
  assert.equal(
    validateUrl('https://counterexamples.org/intro.html').hostname,
    'counterexamples.org'
  );
  for (const value of [
    'http://pages.example',
    'https://pages.example:444',
    'https://name@pages.example',
    'https://@pages.example',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost/',
    'https://pages.example./',
    'https://pages.example/\n',
  ]) {
    assert.throws(() => validateUrl(value));
  }
  assert.throws(() => referenceUrl('https://@pages.example', 'https://pages.example'));
});

test('ipaddr public-only classification rejects special IPv4 and IPv6 families', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(publicAddress(address), true);
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.0.1',
    '100.64.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '::',
    '::1',
    'fe80::1',
    'fec0::1',
    'fc00::1',
    'ff02::1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002::1',
    '2001:db8::1',
    '3fff::1',
    '4000::1',
    'invalid',
  ]) {
    assert.equal(publicAddress(address), false, address);
  }
});

test('every DNS answer is checked before a socket can be opened', async () => {
  for (const answers of [[], ['8.8.8.8', '10.0.0.1'], ['8.8.8.8', '::1']]) {
    let calls = 0;
    const fetch = createFetcher({
      resolve: async () => answers,
      request: () => {
        calls++;
      },
    });
    await assert.rejects(fetch('https://pages.example', META_CAP, signal()));
    assert.equal(calls, 0);
  }
});

test('validated numeric IP is the socket target; original hostname is TLS identity and Host', async (t) => {
  const options = pinnedOptions(new URL('https://pages.example/a?q=1'), '8.8.8.8', signal());
  assert.equal(options.hostname, '8.8.8.8');
  assert.equal(options.servername, 'pages.example');
  assert.equal(options.headers.Host, 'pages.example');
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.agent, false);
  assert.equal(options.port, 443);
  assert.equal(options.path, '/a?q=1');
  assert.equal(options.headers['Accept-Encoding'], 'identity');
  assert.equal(options.headers['User-Agent'], 'Twitterbot/1.0');
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers.Cookie, undefined);
  t.mock.method(https, 'request', (actual, callback) => {
    assert.equal(actual, options);
    const req = new EventEmitter();
    req.setTimeout = (ms) => assert.equal(ms, 5000);
    req.end = () => callback(response());
    return req;
  });
  assert.equal((await requestPinned(options)).statusCode, 200);
});

test('failed addresses fall back safely, preferring IPv6', async () => {
  const sockets = [];
  const fetch = createFetcher({
    resolve: async () => ['8.8.8.8', '2606:4700:4700::1111', '1.1.1.1'],
    request: async (options) => {
      sockets.push(options.hostname);
      return sockets.length === 1 ? response(403) : response();
    },
  });
  const result = await fetch('https://pages.example', META_CAP, signal());
  assert.equal(result.bytes.toString(), '<title>Example</title>');
  assert.deepEqual(sockets, ['2606:4700:4700::1111', '8.8.8.8']);
});

test('redirects revalidate DNS and pin each new public host without leaking headers', async () => {
  const hosts = [];
  const sockets = [];
  const fetch = createFetcher({
    resolve: async (host) => {
      hosts.push(host);
      return [hosts.length === 1 ? '8.8.8.8' : '1.1.1.1'];
    },
    request: async (options) => {
      sockets.push(options);
      return sockets.length === 1
        ? response(302, { location: 'https://cdn.example/page', 'set-cookie': 'ignored' })
        : response();
    },
  });
  const result = await fetch('https://pages.example', META_CAP, signal());
  assert.deepEqual(hosts, ['pages.example', 'cdn.example']);
  assert.equal(sockets[1].hostname, '1.1.1.1');
  assert.equal(sockets[1].headers.Cookie, undefined);
  assert.equal(result.url, 'https://cdn.example/page');
});

test('redirect count, destination policy and changed same-host answers fail closed', async () => {
  let calls = 0;
  const loop = createFetcher({
    resolve: async () => ['8.8.8.8'],
    request: async () => {
      calls++;
      return response(302, { location: '/again' });
    },
  });
  await assert.rejects(loop('https://pages.example', META_CAP, signal()));
  assert.equal(calls, 4);
  for (const location of [
    'http://other.example/',
    'https://@pages.example/',
    'https://127.0.0.1/',
  ]) {
    const fetch = createFetcher({
      resolve: async () => ['8.8.8.8'],
      request: async () => response(302, { location }),
    });
    await assert.rejects(fetch('https://pages.example', META_CAP, signal()));
  }
  let lookups = 0;
  let requests = 0;
  const changed = createFetcher({
    resolve: async () => (++lookups === 1 ? ['8.8.8.8'] : ['10.0.0.1']),
    request: async () => {
      requests++;
      return response(302, { location: '/next' });
    },
  });
  await assert.rejects(changed('https://pages.example', META_CAP, signal()));
  assert.equal(requests, 1);
});

test('identity-only decoded/streamed and declared byte caps, truncated responses', async () => {
  assert.equal(META_CAP, 1048576);
  assert.equal(IMAGE_CAP, 8388608);
  assert.equal(AV_CAP, 52428800);
  assert.equal((await readCapped(response(200, {}, ['1234']), 4)).length, 4);
  for (const headers of [
    { 'content-encoding': 'gzip' },
    { 'content-encoding': 'br' },
    { 'content-length': '5' },
    { 'content-length': 'bad' },
    { 'content-length': '2' },
  ]) {
    await assert.rejects(readCapped(response(200, headers, ['1234']), 4));
  }
  await assert.rejects(readCapped(response(200, {}, ['12', '345']), 4));
  await assert.rejects(readCapped(response(200, { 'content-length': '4' }, ['12']), 4));
});

test('cancellation before resolution or after it never opens a socket', async () => {
  const controller = new AbortController();
  let requests = 0;
  const fetch = createFetcher({
    resolve: async () => {
      controller.abort();
      return ['8.8.8.8'];
    },
    request: async () => {
      requests++;
    },
  });
  await assert.rejects(fetch('https://pages.example', META_CAP, controller.signal));
  await assert.rejects(fetch('https://pages.example', META_CAP, controller.signal));
  assert.equal(requests, 0);
});

test('production DNS resolver queries both A and AAAA and cancels outstanding work', async (t) => {
  const { Resolver } = await import('node:dns/promises');
  const { resolvePublic } = await import('../src/network.js');
  const calls = [];
  t.mock.method(Resolver.prototype, 'resolve4', async (host) => {
    calls.push(['A', host]);
    return ['8.8.8.8'];
  });
  t.mock.method(Resolver.prototype, 'resolve6', async (host) => {
    calls.push(['AAAA', host]);
    return ['2606:4700:4700::1111'];
  });
  t.mock.method(Resolver.prototype, 'cancel', () => calls.push(['cancel']));
  assert.deepEqual(await resolvePublic('pages.example', signal()), [
    '8.8.8.8',
    '2606:4700:4700::1111',
  ]);
  assert.deepEqual(calls, [['A', 'pages.example'], ['AAAA', 'pages.example'], ['cancel']]);
  t.mock.method(Resolver.prototype, 'resolve6', async () => {
    throw Object.assign(new Error(), { code: 'ENODATA' });
  });
  assert.deepEqual(await resolvePublic('pages.example', signal()), ['8.8.8.8']);
  t.mock.method(Resolver.prototype, 'resolve6', async () => {
    throw Object.assign(new Error(), { code: 'ETIMEOUT' });
  });
  await assert.rejects(resolvePublic('pages.example', signal()));
});

test('exactly three validated redirects can succeed', async () => {
  let requests = 0;
  let lookups = 0;
  const fetch = createFetcher({
    resolve: async () => {
      lookups++;
      return ['8.8.8.8'];
    },
    request: async () => (++requests <= 3 ? response(307, { location: '/next' }) : response()),
  });
  assert.equal(
    (await fetch('https://pages.example', META_CAP, signal())).bytes.toString(),
    '<title>Example</title>'
  );
  assert.equal(requests, 4);
  assert.equal(lookups, 4);
});
