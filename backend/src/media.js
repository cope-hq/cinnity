// Conservative signature subset; MIME claims never enable HTML/SVG or player pages.
export function sniff(bytes, kind) {
  const at = (value, offset = 0) =>
    bytes
      .subarray(offset, offset + value.length)
      .equals(Buffer.from(value, 'binary'));
  if (kind === 'image') {
    if (bytes.length >= 24 && at('\x89PNG\r\n\x1a\n') && at('IHDR', 12))
      return 'image/png';
    if (bytes.length >= 4 && at('\xff\xd8\xff')) return 'image/jpeg';
    if (bytes.length >= 13 && (at('GIF87a') || at('GIF89a')))
      return 'image/gif';
    if (
      bytes.length >= 20 &&
      at('RIFF') &&
      at('WEBP', 8) &&
      ['VP8 ', 'VP8L', 'VP8X'].some((s) => at(s, 12))
    )
      return 'image/webp';
  }
  if (kind === 'audio') {
    if (bytes.length >= 44 && at('RIFF') && at('WAVE', 8)) return 'audio/wav';
    if (bytes.length >= 42 && at('fLaC')) return 'audio/flac';
  }
  // ISO BMFF: known MP4/M4A major brands only; no SVG/HTML based on a MIME label.
  if (
    (kind === 'video' || kind === 'audio') &&
    bytes.length >= 24 &&
    at('ftyp', 4) &&
    bytes.readUInt32BE(0) >= 16 &&
    bytes.readUInt32BE(0) <= bytes.length &&
    ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4A '].some((s) =>
      at(s, 8),
    )
  ) {
    if (at('M4A ', 8) && kind !== 'audio') return null;
    return `${kind}/mp4`;
  }
  return null;
}
