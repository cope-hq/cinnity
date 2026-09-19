import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';
import { META_CAP, IMAGE_CAP } from '../src/network.js';
import { Capabilities, PreviewCache, RateLimit } from '../src/limits.js';
import { embedClient } from '../preview-client.js';

const origin = 'https://cinny.example';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);
async function start(t, options = {}) {
  const server = createServer({ origin, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (
  base,
  headers = {},
  body = JSON.stringify({ url: 'https://pages.example/article' })
) =>
  fetch(base + '/_cinny/preview', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body,
  });

test('HTTP contract end to end: rich preview -> opaque same-origin sniffed media', async (t) => {
  const calls = [];
  const base = await start(t, {
    fetchResource: async (url, cap) => {
      calls.push({ url, cap });
      return url.endsWith('/cover.png')
        ? { bytes: png, type: 'text/plain', url }
        : {
            bytes: Buffer.from(
              '<title>Example</title><meta name="description" content="Preview"><meta property="og:image" content="https://cdn.example/cover.png">'
            ),
            type: 'text/html',
            url,
          };
    },
  });
  // Exercise the actual browser adapter against loopback fixtures; production uses relative same-origin paths.
  const client = embedClient(true, (path, options) =>
    fetch(base + path, {
      ...options,
      headers: { ...options.headers, Origin: origin },
    })
  );
  const result = await client.preview('https://pages.example/article');
  assert.equal(result.title, 'Example');
  assert.equal(result.description, 'Preview');
  assert.deepEqual(Object.keys(result).sort(), ['description', 'media', 'title']);
  assert.deepEqual(Object.keys(result.media[0]).sort(), ['id', 'kind']);
  assert.match(result.media[0].id, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(result.media[0].kind, 'image');
  assert.equal(JSON.stringify(result).includes('cdn.example'), false);
  const blob = await client.media(result.media[0]);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
  assert.deepEqual(
    calls.map((c) => c.cap),
    [META_CAP, IMAGE_CAP]
  );
  const response = await fetch(base + '/_cinny/preview/media/' + result.media[0].id);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('request boundary rejects credentials, wrong/missing Origin and unsupported bodies', async (t) => {
  let calls = 0;
  const base = await start(t, {
    fetchResource: async () => {
      calls++;
      throw new Error();
    },
  });
  for (const headers of [
    { Authorization: 'not-a-credential' },
    { Cookie: 'fixture' },
    { 'Proxy-Authorization': 'fixture' },
    { Origin: 'https://other.example' },
    { Origin: 'null' },
    { Origin: '' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const res = await post(base, headers);
    assert.equal(res.status, 403);
    assert.equal(await res.json(), null);
  }
  const missing = await fetch(base + '/_cinny/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(missing.status, 403);
  assert.equal((await post(base, { 'Content-Type': 'text/plain' })).status, 415);
  for (const body of [
    '{',
    'null',
    '[]',
    '{}',
    '{"url":4}',
    '{"url":"https://127.0.0.1"}',
    '{"url":"https://pages.example","extra":1}',
  ])
    assert.equal((await post(base, {}, body)).status, 400);
  assert.equal((await post(base, { 'Content-Encoding': 'gzip' })).status, 400);
  // Oversize input can close the connection before a response, never fetches upstream.
  try {
    assert.equal((await post(base, {}, ' '.repeat(8193))).status, 400);
  } catch (error) {
    assert.equal(error instanceof TypeError, true);
  }
  assert.equal(calls, 0);
});

test('media routes accept only issued, unexpired IDs and never URL/query input', async (t) => {
  let now = 0,
    calls = 0;
  const capabilities = new Capabilities({ now: () => now, ttl: 10 });
  const id = capabilities.issue({
    url: 'https://cdn.example/cover.png',
    kind: 'image',
  });
  const base = await start(t, {
    capabilities,
    fetchResource: async () => {
      calls++;
      return { bytes: png };
    },
  });
  for (const path of [
    '/_cinny/preview/media/https://cdn.example/cover.png',
    '/_cinny/preview/media/' + 'x'.repeat(32),
    `/_cinny/preview/media/${id}?url=https://cdn.example/cover.png`,
  ]) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal(
    (
      await fetch(base + '/_cinny/preview/media/' + id, {
        headers: { Cookie: 'fixture' },
      })
    ).status,
    403
  );
  now = 10;
  assert.equal((await fetch(base + '/_cinny/preview/media/' + id)).status, 404);
  assert.equal(calls, 0);
});

test('empty/unsupported pages return null; failures are generic; HTML media is refused', async (t) => {
  let variant = 0;
  const capabilities = new Capabilities();
  const id = capabilities.issue({
    url: 'https://cdn.example/a',
    kind: 'image',
  });
  const base = await start(t, {
    capabilities,
    fetchResource: async (url) => {
      if (variant === 2) throw new Error('private upstream diagnostic');
      return {
        bytes: Buffer.from('<html></html>'),
        type: variant === 1 ? 'application/json' : 'text/html',
        url,
      };
    },
  });
  for (variant = 0; variant < 2; variant++) {
    const res = await post(base);
    assert.equal(res.status, 200);
    assert.equal(await res.json(), null);
  }
  const res = await post(base);
  assert.equal(res.status, 502);
  assert.equal(await res.text(), 'null');
  variant = 0;
  assert.equal((await fetch(base + '/_cinny/preview/media/' + id)).status, 502);
});

test('media candidates are deduplicated, limited and reject invalid/private URLs', async (t) => {
  const base = await start(t, {
    fetchResource: async (url) => ({
      url,
      type: 'text/html',
      bytes: Buffer.from(`
    <meta property="og:image:secure_url" content="https://127.0.0.1/rejected">
    <meta property="og:image" content="/a"><meta property="og:image" content="/a">
    <meta property="og:image" content="https://cdn.example/b">
    <meta property="og:video" content="/c"><base href="https://other.example/">`),
    }),
  });
  const result = await (await post(base)).json();
  assert.deepEqual(
    result.media.map((m) => m.kind),
    ['image', 'image']
  );
  const other = await start(t, {
    fetchResource: async (url) => ({
      url,
      type: 'text/html',
      bytes: Buffer.from(`
    <title>Still text</title><meta property="og:image" content="https://127.0.0.1/a">`),
    }),
  });
  assert.deepEqual(await (await post(other)).json(), {
    title: 'Still text',
    description: '',
  });
});

test('bounded concurrency, total cancellation, and release after failure', async (t) => {
  let entered;
  const started = new Promise((r) => {
    entered = r;
  });
  let aborted = false;
  const base = await start(t, {
    concurrency: 1,
    totalMs: 150,
    fetchResource: async (_url, _cap, signal) => {
      entered();
      await new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error());
          },
          { once: true }
        )
      );
    },
  });
  const first = post(base).catch(() => null);
  await started;
  assert.equal((await post(base)).status, 503);
  await first;
  assert.equal(aborted, true);
});

test('socket-only source rate limit ignores forwarded addresses', async (t) => {
  const base = await start(t, {
    rate: new RateLimit({ source: 1 }),
    fetchResource: async (url) => ({
      bytes: Buffer.from(''),
      type: 'text/plain',
      url,
    }),
  });
  assert.equal((await post(base, { 'X-Forwarded-For': '192.0.2.1' })).status, 200);
  assert.equal((await post(base, { 'X-Forwarded-For': '192.0.2.2' })).status, 429);
});

test('bounded preview cache expires entries, evicts bytes, and returns snapshots', () => {
  let now = 0;
  const cache = new PreviewCache({
    pageMax: 1,
    pageTtl: 10,
    pageEntryBytes: 100,
    mediaMax: 2,
    mediaTtl: 10,
    mediaBytes: 5,
    now: () => now,
  });

  const page = { result: { title: 'One' }, refs: [] };
  cache.putPage('one', page);
  page.result.title = 'Changed';
  const firstPage = cache.getPage('one');
  assert.equal(firstPage.result.title, 'One');
  firstPage.result.title = 'Also changed';
  assert.equal(cache.getPage('one').result.title, 'One');
  cache.putPage('two', { result: { title: 'Two' }, refs: [] });
  assert.equal(cache.getPage('one'), undefined);

  const bytes = Buffer.from('123');
  cache.putMedia('one', bytes, 'image/png');
  bytes[0] = 0;
  const firstMedia = cache.getMedia('one');
  assert.deepEqual(firstMedia.bytes, Buffer.from('123'));
  firstMedia.bytes[0] = 0;
  assert.deepEqual(cache.getMedia('one').bytes, Buffer.from('123'));
  cache.putMedia('two', Buffer.from('456'), 'image/png');
  assert.equal(cache.getMedia('one'), undefined);
  assert.equal(cache.mediaSize, 3);

  now = 10;
  assert.equal(cache.getPage('two'), undefined);
  assert.equal(cache.getMedia('two'), undefined);
  assert.equal(cache.mediaSize, 0);
});

test('successful previews and validated media are reused from the bounded cache', async (t) => {
  let now = 0;
  const calls = [];
  const base = await start(t, {
    cache: new PreviewCache({ pageTtl: 10, mediaTtl: 5, now: () => now }),
    fetchResource: async (url) => {
      calls.push(url);
      return url.endsWith('/cover.png')
        ? { bytes: png, type: 'text/plain', url }
        : {
            bytes: Buffer.from(
              '<title>Cached</title><meta property="og:image" content="https://cdn.example/cover.png">'
            ),
            type: 'text/html',
            url,
          };
    },
  });

  const first = await (await post(base)).json();
  const second = await (
    await post(base, {}, JSON.stringify({ url: 'https://pages.example/article#another-fragment' }))
  ).json();
  assert.notEqual(first.media[0].id, second.media[0].id);
  assert.deepEqual(calls, ['https://pages.example/article']);

  assert.equal((await fetch(`${base}/_cinny/preview/media/${first.media[0].id}`)).status, 200);
  assert.equal((await fetch(`${base}/_cinny/preview/media/${second.media[0].id}`)).status, 200);
  assert.deepEqual(calls, ['https://pages.example/article', 'https://cdn.example/cover.png']);

  now = 5;
  assert.equal((await fetch(`${base}/_cinny/preview/media/${second.media[0].id}`)).status, 200);
  assert.equal(calls.length, 3);
  now = 10;
  await post(base);
  assert.equal(calls.length, 4);
});

test('bounded TTL capabilities and global/per-source fixed-window limits', () => {
  let now = 0;
  const capabilities = new Capabilities({ max: 2, ttl: 10, now: () => now });
  const first = capabilities.issue('a'),
    second = capabilities.issue('b'),
    third = capabilities.issue('c');
  assert.notEqual(second, third);
  assert.equal(capabilities.get(first), undefined);
  assert.equal(capabilities.entries.size, 2);
  now = 10;
  assert.equal(capabilities.get(second), undefined);
  assert.equal(capabilities.entries.size, 0);
  const rate = new RateLimit({
    global: 3,
    source: 2,
    maxSources: 2,
    window: 10,
    now: () => now,
  });
  assert.equal(rate.allow('one'), true);
  assert.equal(rate.allow('one'), true);
  assert.equal(rate.allow('one'), false);
  assert.equal(rate.allow('two'), false);
  now = 20;
  assert.equal(rate.allow('two'), true);
  const bounded = new RateLimit({ maxSources: 1 });
  assert.equal(bounded.allow('one'), true);
  assert.equal(bounded.allow('two'), false);
  assert.equal(bounded.sources.size, 1);
});

test('browser adapter defaults off, same-origin paths and credential omission only', async () => {
  let calls = 0;
  const fetcher = async (path, options) => {
    calls++;
    assert.equal(path, '/_cinny/preview');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), {
      url: 'https://pages.example',
    });
    return new Response('null', {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  assert.equal(await embedClient(false, fetcher).preview('https://pages.example'), null);
  assert.equal(await embedClient('true', fetcher).preview('https://pages.example'), null);
  assert.equal(calls, 0);
  assert.equal(await embedClient(true, fetcher).preview('https://pages.example'), null);
  assert.equal(calls, 1);
  await assert.rejects(
    embedClient(true, fetcher).media({
      id: 'https://cdn.example',
      kind: 'image',
    })
  );
  await assert.rejects(embedClient(false, fetcher).media({ id: 'x'.repeat(32), kind: 'image' }));
});
