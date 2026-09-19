/**
 * Optional preview-server frontend adapter.
 *
 * Ported from cinny-old (`src/lib/embed-backend.ts`). The default Cinny
 * build uses consent-gated homeserver `getUrlPreview` cards only
 * (`UrlPreviewCard`). Enable this opt-in path at build time with
 * `VITE_EMBED_BACKEND=true` when deploying the preview-only Node backend in
 * `backend/` on the frontend's own origin.
 *
 * Contract (same-origin, credential-free, no Matrix tokens):
 * - `POST /_cinny/preview` with `{ url }` returns preview JSON or null.
 * - `GET /_cinny/preview/media/:id` for card media (32-char base64url ids).
 * No fallback to the homeserver on backend failure.
 */

export const embedBackendEnabled =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_EMBED_BACKEND === 'true';

export type EmbedPreviewMediaKind = 'image' | 'video' | 'audio';
export interface EmbedPreviewMedia {
  id: string;
  kind: EmbedPreviewMediaKind;
}
export interface EmbedPreview {
  title: string;
  description: string;
  siteName?: string;
  author?: string;
  color?: string;
  media?: EmbedPreviewMedia[];
}

const capability = /^[A-Za-z0-9_-]{32}$/;
const invalid = () => new Error('Preview server response invalid. Retry explicitly.');

const strictObject = (v: unknown, keys: string[]): Record<string, unknown> => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((key) => !keys.includes(key))
  )
    throw invalid();
  return v as Record<string, unknown>;
};

const strictText = (raw: unknown, cap: number): string => {
  if (typeof raw !== 'string' || Array.from(raw).length > cap) throw invalid();
  return (
    raw
      // This deliberately strips C0/C1 controls and Unicode bidi formatting.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
};

export function parseEmbedPreview(value: unknown): EmbedPreview | null {
  if (value === null) return null;
  const v = strictObject(value, ['title', 'description', 'siteName', 'author', 'color', 'media']);
  const result: EmbedPreview = {
    title: strictText(v.title, 300),
    description: strictText(v.description, 700),
  };
  if (v.siteName !== undefined) result.siteName = strictText(v.siteName, 100);
  if (v.author !== undefined) result.author = strictText(v.author, 200);
  if (v.color !== undefined) {
    if (typeof v.color !== 'string' || !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(v.color))
      throw invalid();
    result.color = v.color.toLowerCase();
  }
  if (v.media !== undefined) {
    if (!Array.isArray(v.media) || v.media.length > 2) throw invalid();
    const ids = new Set<string>();
    result.media = v.media.map((raw) => {
      const ref = strictObject(raw, ['id', 'kind']);
      if (
        typeof ref.id !== 'string' ||
        !capability.test(ref.id) ||
        ids.has(ref.id) ||
        !['image', 'video', 'audio'].includes(ref.kind as string)
      )
        throw invalid();
      ids.add(ref.id);
      return { id: ref.id, kind: ref.kind as EmbedPreviewMediaKind };
    });
  }
  return result;
}

async function requestBytes(path: string, options: RequestInit, cap: number): Promise<Uint8Array> {
  if (!embedBackendEnabled) throw new Error('Preview server is disabled.');

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = window.setTimeout(abort, 25000);
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      mode: 'same-origin',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error('Preview server unavailable. Check deployment and retry.');
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length < 0 || length > cap) throw invalid();
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      // A streaming loop is required so the response is rejected before it can
      // exceed the preview contract's byte cap.
      /* eslint-disable no-await-in-loop, no-restricted-syntax */
      for (;;) {
        controller.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > cap) throw invalid();
        chunks.push(value);
      }
      /* eslint-enable no-await-in-loop, no-restricted-syntax */
      controller.signal.throwIfAborted();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return bytes;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.slice(start, end));

const rasterType = (bytes: Uint8Array): string => {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
};

const playableType = (bytes: Uint8Array, kind: EmbedPreviewMediaKind): string => {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE')
    return 'audio/wav';
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'fLaC') return 'audio/flac';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const brand = ascii(bytes, 8, 12);
    if (
      size >= 16 &&
      size <= bytes.length &&
      ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4A ', 'dash', 'qt  '].includes(brand)
    )
      return kind === 'audio' || brand === 'M4A ' ? 'audio/mp4' : 'video/mp4';
  }
  return 'application/octet-stream';
};

export const fetchEmbedPreview = async (url: string): Promise<EmbedPreview | null> => {
  const bytes = await requestBytes(
    '/_cinny/preview',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    },
    16 * 1024
  );
  try {
    return parseEmbedPreview(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw invalid();
  }
};

export const fetchEmbedMedia = async (
  ref: EmbedPreviewMedia,
  signal: AbortSignal
): Promise<Blob> => {
  if (!capability.test(ref.id) || !['image', 'video', 'audio'].includes(ref.kind)) throw invalid();
  const bytes = await requestBytes(
    `/_cinny/preview/media/${ref.id}`,
    { method: 'GET', signal },
    (ref.kind === 'image' ? 8 : 50) * 1024 * 1024
  );
  const type = ref.kind === 'image' ? rasterType(bytes) : playableType(bytes, ref.kind);
  let allowed: string[];
  if (ref.kind === 'image') allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  else if (ref.kind === 'audio') allowed = ['audio/wav', 'audio/flac', 'audio/mp4'];
  else allowed = ['video/mp4'];
  if (!allowed.includes(type)) throw invalid();
  return new Blob([bytes], { type });
};
