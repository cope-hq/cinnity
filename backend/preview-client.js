// Browser-only opt-in adapter. No Matrix client/token argument or configurable base URL.
// Not wired into the existing frontend by this backend-only change.
export function embedClient(enabled = false, fetcher = globalThis.fetch) {
  const request = async (path, options, cap) => {
    const response = await fetcher(path, {
      ...options,
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(25_000)])
        : AbortSignal.timeout(25_000),
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error('Preview unavailable; retry explicitly.');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > cap) throw new Error('Preview too large.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return new Blob(chunks, {
      type: response.headers.get('content-type') || '',
    });
  };
  return {
    async preview(url, signal) {
      if (enabled !== true) return null;
      const blob = await request(
        '/_cinny/preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal,
        },
        16 * 1024,
      );
      return JSON.parse(await blob.text());
    },
    async media(ref, signal) {
      if (
        enabled !== true ||
        !/^[A-Za-z0-9_-]{32}$/.test(ref?.id) ||
        !['image', 'video', 'audio'].includes(ref.kind)
      ) {
        throw new Error('Preview media unavailable.');
      }
      return request(
        `/_cinny/preview/media/${ref.id}`,
        { method: 'GET', signal },
        (ref.kind === 'image' ? 8 : 50) * 1024 * 1024,
      );
    },
  };
}
