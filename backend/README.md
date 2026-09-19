# Optional Cinny preview backend (Node 24)

This is an optional, same-origin link-preview service. The default Cinny package remains browser-only; build the package with `enableEmbeds = true` to include the frontend adapter and `cinny-embeds` executable.

## Run

```sh
cd backend
npm ci --ignore-scripts
ORIGIN=https://chat.example.org PORT=8787 npm start
```

`ORIGIN` is the exact public HTTPS frontend origin, without a path or trailing slash. `PORT` defaults to `8787`. The process always listens on `127.0.0.1`.

The service accepts arbitrary valid public HTTPS hostnames. There is no hostname allowlist. It does not accept IP-literal URLs, userinfo, non-HTTPS URLs, nonstandard ports, single-label names, or malformed hostnames.

## Routes

### `POST /_cinny/preview`

Requires an exact same-origin `Origin` header and `Content-Type: application/json` with a body containing only:

```json
{ "url": "https://example.org/page" }
```

The response is normalized metadata or `null`:

```ts
{
  title: string;
  description: string;
  siteName?: string;
  author?: string;
  color?: string;
  media?: { id: string; kind: 'image' | 'video' | 'audio' }[];
} | null
```

Remote media URLs are never exposed to the browser. Metadata is bounded and treated as untrusted plain text.

### `GET /_cinny/preview/media/:id`

Fetches a short-lived opaque media capability issued by the preview route. Responses are downloaded, bounded, signature-sniffed, and buffered before being returned. Supported types are PNG, JPEG, GIF, WebP, WAV, FLAC, and a restricted MP4/M4A family.

## Network protections

Every page, redirect, and media request repeats all checks:

- HTTPS on port 443 only
- no credentials or IP-literal URL host
- A and AAAA DNS lookup with a short timeout
- **every** returned address must be globally routable; one private/special answer rejects the request before opening a socket
- the socket is pinned to a validated numeric address while TLS SNI, certificate verification, and `Host` use the original hostname
- all validated addresses may be tried, preferring IPv6, to tolerate broken or selectively blocked CDN edges
- redirect destinations are independently URL-validated and DNS-validated, with at most three redirects
- five-second per-request timeout and twenty-second total backend deadline
- 1 MiB HTML, 8 MiB image, and 50 MiB audio/video limits
- no cookies, authorization, Matrix credentials, upstream cookies, compression, proxy environment, or shared HTTP agent

The backend deliberately emits generic errors and does not log requested URLs or upstream diagnostics.

## Browser/request boundary

- POST requires the exact configured origin.
- `Authorization`, `Proxy-Authorization`, and `Cookie` are rejected on every route.
- `Sec-Fetch-Site`, when supplied, must be `same-origin`.
- The frontend fetches with `credentials: omit`, `referrerPolicy: no-referrer`, and no homeserver fallback.
- Capabilities are random 192-bit values, expire after five minutes, and are stored only in bounded process memory.

## Resource limits and cache

- Up to four concurrent requests and 64 accepted connections
- Fixed-window process/source rate limits
- Metadata cache: 256 successful entries, ten minutes, 16 KiB each
- Media cache: 128 validated entries, five minutes, 128 MiB total
- Capability map: 512 entries, five minutes
- All HTTP responses remain `Cache-Control: no-store`
- Restart clears capabilities and caches

## Nix

The package defaults to browser-only:

```nix
inputs.cinny.packages.${system}.cinny
```

Enable the backend integration explicitly:

```nix
inputs.cinny.packages.${system}.cinny.override {
  enableEmbeds = true;
  conf = {
    defaultHomeserver = 0;
    homeserverList = [ "matrix.example.org" ];
    allowCustomHomeservers = true;
  };
}
```

Serve `${cinny}/share/cinny` and run `${cinny}/bin/cinny-embeds` with `ORIGIN` and `PORT`. Proxy only the exact preview route and media prefix. Strip credential headers at the reverse proxy as defense in depth.

## Tests

```sh
cd backend
npm test
npm run check
```
