import https from 'node:https';
import { spawn } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import ipaddr from 'ipaddr.js';

export const META_CAP = 1024 * 1024;
export const IMAGE_CAP = 8 * META_CAP;
export const AV_CAP = 50 * META_CAP;
export const fail = () => new Error('Preview unavailable');

export function hostname(value) {
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    isIP(value) ||
    ipaddr.isValid(value) ||
    !value.includes('.') ||
    !value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw fail();
  return value;
}

export function validateUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !/^https:\/\/[^/?#]+/i.test(value) ||
    /[\s\\\u0000-\u001f\u007f]/u.test(value)
  )
    throw fail();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail();
  }
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    // Also disallow empty userinfo, which URL normalizes away.
    /^https:\/\/[^/?#]*@/i.test(value)
  )
    throw fail();
  hostname(url.hostname);
  url.hash = '';
  return url;
}

export function referenceUrl(value, base) {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    /[\u0000-\u0020\u007f\\]/u.test(value) ||
    /\/\/[^/?#]*@/.test(value)
  )
    throw fail();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return validateUrl(value);
  if (value.startsWith('//') && !/^\/\/[^/?#]+/.test(value)) throw fail();
  return validateUrl(new URL(value, base).href);
}

export function publicAddress(address) {
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  return (
    parsed.range() === 'unicast' &&
    (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parseCIDR('2000::/3')))
  );
}

// Query both families, not ADDRCONFIG-filtered OS answers. Every answer must be
// public before any connection is attempted. Cancellation frees DNS work.
export async function resolvePublic(host, signal) {
  signal.throwIfAborted();
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const query = async (family) => {
      try {
        return await resolver[`resolve${family}`](host);
      } catch (error) {
        if (error.code === 'ENODATA') return [];
        throw fail();
      }
    };
    const answers = (await Promise.all([query(4), query(6)])).flat();
    signal.throwIfAborted();
    return answers;
  } finally {
    resolver.cancel();
    signal.removeEventListener('abort', cancel);
  }
}

// hostname is the validated numeric address: the socket cannot perform a second DNS lookup.
// TLS SNI and certificate verification use the original hostname; no shared/reused agent.
export function pinnedOptions(url, address, signal) {
  return {
    protocol: 'https:',
    hostname: address,
    family: isIP(address),
    port: 443,
    servername: url.hostname,
    rejectUnauthorized: true,
    agent: false,
    method: 'GET',
    path: url.pathname + url.search,
    signal,
    maxHeaderSize: 16384,
    headers: {
      Host: url.hostname,
      'User-Agent': 'Twitterbot/1.0',
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    },
  };
}

export function requestPinned(options) {
  return new Promise((resolve, reject) => {
    const request = https.request(options, resolve);
    request.on('error', () => reject(fail()));
    request.setTimeout(5000, () => request.destroy(fail()));
    request.end();
  });
}

const CURL_WRITE_OUT = '%{stderr}%{json}\\n--cinny-headers--\\n%{header_json}';

// libcurl is used for outbound HTTP because some public CDNs reject Node's TLS
// fingerprint even for their documented crawler responses. DNS resolution is
// still performed and validated here; --resolve pins curl to that exact address.
export function requestCurl(options, cap) {
  return new Promise((resolve, reject) => {
    const address = options.family === 6 ? `[${options.hostname}]` : options.hostname;
    const executable = process.env.CINNY_CURL || 'curl';
    const child = spawn(
      executable,
      [
        '--silent',
        '--http1.1',
        '--noproxy',
        '*',
        '--proto',
        '=https',
        '--connect-timeout',
        '5',
        '--max-time',
        '5',
        '--max-filesize',
        String(cap),
        '--resolve',
        `${options.servername}:443:${address}`,
        '--user-agent',
        options.headers['User-Agent'],
        '--header',
        'Accept: */*',
        '--header',
        'Accept-Encoding: identity',
        '--output',
        '-',
        '--write-out',
        CURL_WRITE_OUT,
        `https://${options.servername}${options.path}`,
      ],
      {
        env: { PATH: process.env.PATH || '' },
        signal: options.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const body = [];
    const diagnostic = [];
    let bodySize = 0;
    let diagnosticSize = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      error ? reject(fail()) : resolve(value);
    };
    child.once('error', () => finish(fail()));
    child.stdout.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > cap) {
        child.kill('SIGKILL');
        finish(fail());
        return;
      }
      body.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      diagnosticSize += chunk.length;
      if (diagnosticSize > 64 * 1024) {
        child.kill('SIGKILL');
        finish(fail());
        return;
      }
      diagnostic.push(chunk);
    });
    child.once('close', (code) => {
      if (code !== 0) return finish(fail());
      try {
        const output = Buffer.concat(diagnostic, diagnosticSize).toString('utf8');
        const separator = '\n--cinny-headers--\n';
        const split = output.indexOf(separator);
        if (split < 0) throw fail();
        const info = JSON.parse(output.slice(0, split));
        const rawHeaders = JSON.parse(output.slice(split + separator.length));
        const headers = Object.fromEntries(
          Object.entries(rawHeaders).map(([key, values]) => [
            key.toLowerCase(),
            Array.isArray(values) ? values.join(', ') : String(values),
          ])
        );
        const statusCode = Number(info.response_code);
        if (!Number.isInteger(statusCode)) throw fail();
        finish(
          null,
          Object.assign(Readable.from([Buffer.concat(body, bodySize)]), {
            statusCode,
            headers,
          })
        );
      } catch {
        finish(fail());
      }
    });
  });
}

export async function readCapped(stream, cap) {
  const encoding = stream.headers?.['content-encoding'];
  if (encoding && encoding.toLowerCase() !== 'identity') {
    stream.destroy();
    throw fail();
  }
  const length = stream.headers?.['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > cap)) {
    stream.destroy();
    throw fail();
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > cap) {
      stream.destroy();
      throw fail();
    }
    chunks.push(chunk);
  }
  if (length !== undefined && size !== Number(length)) throw fail();
  return Buffer.concat(chunks, size);
}

const candidateAddresses = (answers) => {
  if (!answers.length || answers.length > 32 || !answers.every(publicAddress)) throw fail();
  // IPv6 often avoids IPv4-only anti-bot blocks. Keep DNS order within each family,
  // deduplicate answers, and still fall back to every validated address.
  return [...new Set(answers)].sort((a, b) => isIP(b) - isIP(a));
};

// Dependencies are internal test seams only; never configured from HTTP or environment.
export function createFetcher({ resolve = resolvePublic, request = requestCurl } = {}) {
  return async (input, cap, signal) => {
    let url = validateUrl(input);
    for (let redirects = 0; ; redirects++) {
      signal.throwIfAborted();
      const addresses = candidateAddresses(await resolve(url.hostname, signal));
      signal.throwIfAborted();

      let response;
      for (const address of addresses) {
        signal.throwIfAborted();
        try {
          const candidate = await request(pinnedOptions(url, address, signal), cap);
          if (
            candidate.statusCode === 200 ||
            [301, 302, 303, 307, 308].includes(candidate.statusCode)
          ) {
            response = candidate;
            break;
          }
          candidate.destroy();
        } catch {
          signal.throwIfAborted();
        }
      }
      if (!response) throw fail();

      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        if (redirects >= 3 || typeof response.headers.location !== 'string') throw fail();
        url = referenceUrl(response.headers.location, url);
        continue;
      }
      const bytes = await readCapped(response, cap);
      signal.throwIfAborted();
      return {
        bytes,
        url: url.href,
        type: response.headers['content-type']?.split(';')[0].trim().toLowerCase(),
      };
    }
  };
}
