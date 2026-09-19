import http from 'node:http';
import { once } from 'node:events';
import {
  createFetcher,
  validateUrl,
  referenceUrl,
  readCapped,
  META_CAP,
  IMAGE_CAP,
  AV_CAP,
} from './network.js';
import { parseMetadata } from './parse.js';
import { sniff } from './media.js';
import { Capabilities, PreviewCache, RateLimit } from './limits.js';

export function createServer({
  origin,
  fetchResource = createFetcher(),
  capabilities = new Capabilities(),
  cache = new PreviewCache(),
  rate = new RateLimit(),
  concurrency = 4,
  totalMs = 20_000,
}) {
  let active = 0;
  const server = http.createServer(
    {
      maxHeaderSize: 8192,
      requestTimeout: 10_000,
      headersTimeout: 5000,
      keepAliveTimeout: 1000,
    },
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; sandbox; frame-ancestors 'none'"
      );
      // No request/body/URL/header/error logging; never reflect upstream headers/errors.
      const json = (status, value = null) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          Connection: 'close',
        });
        res.end(JSON.stringify(value));
      };
      if (!rate.allow(req.socket.remoteAddress || 'unknown')) return json(429);
      if (
        'authorization' in req.headers ||
        'cookie' in req.headers ||
        'proxy-authorization' in req.headers
      )
        return json(403);
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
        return json(403);
      if (req.headers.origin !== undefined && req.headers.origin !== origin) return json(403);
      const post = req.method === 'POST' && req.url === '/_cinny/preview';
      const media =
        req.method === 'GET' && /^\/_cinny\/preview\/media\/([A-Za-z0-9_-]{32})$/.exec(req.url);
      if (!post && !media) return json(404);
      if (post && req.headers.origin !== origin) return json(403);
      if (
        post &&
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')
      )
        return json(415);
      if (
        post &&
        ((req.headers['content-encoding'] &&
          req.headers['content-encoding'].toLowerCase() !== 'identity') ||
          (req.headers['content-length'] !== undefined &&
            Number(req.headers['content-length']) > 8192))
      )
        return json(400);
      if (active >= concurrency) return json(503);
      active++;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        res.destroy();
        req.destroy();
      }, totalMs);
      const disconnected = () => controller.abort();
      res.once('close', disconnected);
      try {
        if (post) {
          let input;
          try {
            input = JSON.parse((await readCapped(req, 8192)).toString('utf8'));
            if (
              !input ||
              Array.isArray(input) ||
              Object.keys(input).length !== 1 ||
              !Object.hasOwn(input, 'url')
            )
              throw new Error();
            input = validateUrl(input.url).href;
          } catch {
            return json(400);
          }
          let preview = cache.getPage(input);
          if (!preview) {
            const page = await fetchResource(input, META_CAP, controller.signal);
            if (page.type !== 'text/html') return json(200);
            const { result, candidates } = await parseMetadata(page.bytes, controller.signal);
            const refs = [];
            const seen = new Set();
            for (const candidate of candidates) {
              try {
                const url = referenceUrl(candidate.url, page.url).href;
                if (seen.has(url)) continue;
                seen.add(url);
                refs.push({ url, kind: candidate.kind });
                if (refs.length === 2) break;
              } catch {
                /* Unsupported media does not discard text metadata. */
              }
            }
            if (!Object.values(result).some(Boolean) && refs.length === 0) return json(200);
            preview = { result, refs };
            controller.signal.throwIfAborted();
            cache.putPage(input, preview);
          }

          const output = { ...preview.result };
          const mediaRefs = preview.refs.map((ref) => ({
            id: capabilities.issue(ref),
            kind: ref.kind,
          }));
          if (mediaRefs.length) output.media = mediaRefs;
          json(200, output);
        } else {
          const ref = capabilities.get(media[1]);
          if (!ref) return json(404);
          const cap = ref.kind === 'image' ? IMAGE_CAP : AV_CAP;
          const mediaKey = `${ref.kind}\u0000${ref.url}`;
          let resource = cache.getMedia(mediaKey);
          if (!resource) {
            const fetched = await fetchResource(ref.url, cap, controller.signal);
            const type = sniff(fetched.bytes, ref.kind);
            if (!type || fetched.bytes.length > cap) return json(502);
            resource = { bytes: fetched.bytes, type };
            controller.signal.throwIfAborted();
            cache.putMedia(mediaKey, resource.bytes, resource.type);
          }
          res.writeHead(200, {
            'Content-Type': resource.type,
            'Content-Length': resource.bytes.length,
            'Content-Disposition': 'inline; filename="preview"',
            Connection: 'close',
          });
          // Keep the concurrency slot and total deadline through a slow client write.
          const finished = once(res, 'finish', { signal: controller.signal });
          res.end(resource.bytes);
          await finished;
        }
      } catch {
        if (!res.destroyed && !res.headersSent) json(502);
        else res.destroy();
      } finally {
        clearTimeout(timer);
        controller.abort();
        res.removeListener('close', disconnected);
        active--;
      }
    }
  );
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  server.setTimeout(10_000, (socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('checkContinue', (_req, res) => {
    res.writeHead(417, { Connection: 'close' });
    res.end();
  });
  return server;
}
