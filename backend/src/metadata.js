import { parse } from 'parse5';

export function text(value, cap) {
  return [
    ...(value || '')
      .replace(
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu,
        ''
      )
      .replace(/\s+/gu, ' ')
      .trim(),
  ]
    .slice(0, cap)
    .join('');
}

// parse5 parses only: no scripts, fetches, DOM execution or oEmbed HTML.
export function metadata(html) {
  const doc = parse(html);
  const head = doc.childNodes
    .find((n) => n.tagName === 'html')
    ?.childNodes.find((n) => n.tagName === 'head');
  const values = new Map();
  const mediaKey = /^(?:og:(?:image|video|audio)(?::(?:secure_url|url))?|twitter:image(?::src)?)$/;
  let title = '';
  for (const node of head?.childNodes || []) {
    if (node.tagName === 'title' && !title)
      title = node.childNodes.map((n) => n.value || '').join('');
    if (node.tagName !== 'meta') continue;
    const attrs = Object.fromEntries(node.attrs.map((a) => [a.name, a.value]));
    const key = (attrs.property || attrs.name || '').toLowerCase();
    const value = text(attrs.content || '', 4096);
    if (!value) continue;
    const existing = values.get(key) || [];
    // Keep enough media fallbacks for validation to skip broken leading URLs,
    // while bounding the hostile-page worker result. Ordinary text remains
    // first-value-wins.
    const duplicateCap = mediaKey.test(key) ? 16 : 1;
    if (existing.length < duplicateCap) {
      existing.push(attrs.content.trim());
      values.set(key, existing);
    }
  }
  const pickAll = (...keys) => keys.flatMap((key) => values.get(key) || []);
  const pick = (...keys) => keys.map((key) => values.get(key)?.[0]).find((value) => value) || '';
  const result = {
    title: text(pick('og:title', 'twitter:title') || title, 300),
    description: text(pick('og:description', 'twitter:description', 'description'), 700),
  };
  for (const [key, value, cap] of [
    ['siteName', pick('og:site_name', 'twitter:site', 'application-name'), 100],
    ['author', pick('article:author', 'author', 'twitter:creator'), 200],
  ]) {
    const clean = text(value, cap);
    if (clean) result[key] = clean;
  }
  const color = pick('theme-color').trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) result.color = color.toLowerCase();
  const candidates = [];
  for (const kind of ['image', 'video', 'audio']) {
    const urls = pickAll(
      `og:${kind}:secure_url`,
      `og:${kind}:url`,
      `og:${kind}`,
      ...(kind === 'image' ? ['twitter:image', 'twitter:image:src'] : [])
    );
    for (const url of urls) {
      if (url.length <= 4096) candidates.push({ kind, url });
    }
  }
  return { result, candidates };
}
