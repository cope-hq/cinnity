/**
 * Link previews that failed to load, so the message menu can offer a retry
 * instead of each failed card showing its own button.
 */

const failed = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

export const setPreviewFailed = (url: string, isFailed: boolean) => {
  if (isFailed) failed.add(url);
  else failed.delete(url);
};

/** Failed preview URLs that appear in a message's text. */
export const getFailedPreviewUrls = (text: string): string[] =>
  Array.from(failed).filter(
    // Previews use normalized URLs, which may gain a trailing slash.
    (url) => text.includes(url) || text.includes(url.replace(/\/$/, ''))
  );

export const retryPreviews = (urls: string[]) => {
  urls.forEach((url) => listeners.get(url)?.forEach((listener) => listener()));
};

export const onPreviewRetry = (url: string, listener: () => void) => {
  const set = listeners.get(url) ?? new Set();
  set.add(listener);
  listeners.set(url, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(url);
  };
};
