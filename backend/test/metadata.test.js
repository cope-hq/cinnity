import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metadata } from '../src/metadata.js';
import { parseMetadata } from '../src/parse.js';
import { sniff } from '../src/media.js';

const fixture = `<!doctype html><head><title>Fallback</title>
<meta property="og:title" content=" A &amp; B "><meta name="twitter:title" content="Twitter">
<meta property="og:description" content="Some   text"><meta property="og:site_name" content="Example">
<meta name="author" content="An author"><meta name="theme-color" content="#AbC">
<meta property="og:image" content="/cover.png"><meta property="og:video" content="https://cdn.example/clip.mp4">
<link rel="alternate" type="application/json+oembed" href="/embed">
<script>throw new Error('not executed')</script></head>`;

test('positive OG adapter fixture: normalized rich text and inert discovery', async () => {
  const expected = {
    result: {
      title: 'A & B',
      description: 'Some text',
      siteName: 'Example',
      author: 'An author',
      color: '#abc',
    },
    candidates: [
      { kind: 'image', url: '/cover.png' },
      { kind: 'video', url: 'https://cdn.example/clip.mp4' },
    ],
  };
  assert.deepEqual(metadata(fixture), expected);
  assert.deepEqual(await parseMetadata(Buffer.from(fixture), AbortSignal.timeout(2000)), expected);
});

test('Twitter and ordinary title/description fallbacks; Unicode and safe color bounds', () => {
  assert.equal(metadata('<title>Plain &amp; text</title>').result.title, 'Plain & text');
  const { result, candidates } = metadata(`<meta name="twitter:title" content="${'😀'.repeat(400)}">
    <meta name="description" content="${'d'.repeat(
      800
    )}"><meta name="twitter:creator" content="${'a'.repeat(250)}">
    <meta name="twitter:site" content="${'s'.repeat(
      150
    )}"><meta name="theme-color" content="url(no)">
    <meta name="twitter:image" content="/image"><meta name="twitter:player" content="/player">`);
  assert.equal([...result.title].length, 300);
  assert.equal(result.description.length, 700);
  assert.equal(result.author.length, 200);
  assert.equal(result.siteName.length, 100);
  assert.equal(result.color, undefined);
  assert.deepEqual(candidates, [{ kind: 'image', url: '/image' }]);
  assert.equal(metadata('<title>A\u202e B\u0001</title>').result.title, 'A B');
});

test('body/template/script metadata and oEmbed markup are not resources', () => {
  const parsed = metadata(
    '<head><template><meta property="og:image" content="/hidden"></template></head><body><meta property="og:title" content="ignored"><iframe src="/player"></iframe>'
  );
  assert.deepEqual(parsed, {
    result: { title: '', description: '' },
    candidates: [],
  });
});

test('worker cancellation has a bounded exit', async () => {
  const controller = new AbortController();
  const parsed = parseMetadata(Buffer.from(fixture), controller.signal);
  controller.abort();
  await assert.rejects(parsed);
});

test('signature fixtures support only passive image and audio/video subsets', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.write('IHDR', 12);
  const mp4 = Buffer.alloc(24);
  mp4.writeUInt32BE(24);
  mp4.write('ftypisom', 4);
  const wav = Buffer.alloc(44);
  wav.write('RIFF');
  wav.write('WAVE', 8);
  const flac = Buffer.alloc(42);
  flac.write('fLaC');
  const webp = Buffer.alloc(20);
  webp.write('RIFF');
  webp.write('WEBPVP8 ', 8);
  for (const [bytes, kind, type] of [
    [png, 'image', 'image/png'],
    [Buffer.from([255, 216, 255, 224]), 'image', 'image/jpeg'],
    [Buffer.from('GIF89a1234567'), 'image', 'image/gif'],
    [webp, 'image', 'image/webp'],
    [mp4, 'video', 'video/mp4'],
    [mp4, 'audio', 'audio/mp4'],
    [wav, 'audio', 'audio/wav'],
    [flac, 'audio', 'audio/flac'],
  ]) {
    assert.equal(sniff(bytes, kind), type);
  }
  for (const bytes of [
    Buffer.from('<svg/>'),
    Buffer.from('<html/>'),
    Buffer.alloc(0),
    png.subarray(0, 8),
  ]) {
    for (const kind of ['image', 'video', 'audio']) assert.equal(sniff(bytes, kind), null);
  }
  assert.equal(sniff(mp4, 'image'), null);
  assert.equal(sniff(png, 'video'), null);
});

test('repeated media and lower-precedence fallbacks remain available for validation', () => {
  const { candidates } = metadata(`
    <meta property="og:image:secure_url" content=" https://other.example/preferred.jpg ">
    <meta property="og:image" content=" /one.jpg ">
    <meta property="og:image" content="/two.jpg">
    <meta property="og:image" content="/three.jpg">
    <meta name="twitter:image" content="/twitter-fallback.jpg">
  `);
  assert.deepEqual(candidates, [
    { kind: 'image', url: 'https://other.example/preferred.jpg' },
    { kind: 'image', url: '/one.jpg' },
    { kind: 'image', url: '/two.jpg' },
    { kind: 'image', url: '/three.jpg' },
    { kind: 'image', url: '/twitter-fallback.jpg' },
  ]);
});

test('blank metadata does not suppress a later useful duplicate', () => {
  assert.equal(
    metadata('<meta property="og:title" content="   "><meta property="og:title" content="Useful">')
      .result.title,
    'Useful'
  );
});

test('M4A capability is audio-only, matching the browser contract', () => {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftyp', 4);
  bytes.write('M4A ', 8);
  assert.equal(sniff(bytes, 'audio'), 'audio/mp4');
  assert.equal(sniff(bytes, 'video'), null);
});
