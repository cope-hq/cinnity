import { randomBytes } from 'node:crypto';

export class Capabilities {
  constructor({ max = 512, ttl = 300_000, now = Date.now } = {}) {
    Object.assign(this, { max, ttl, now });
    this.entries = new Map();
  }
  prune() {
    for (const [id, entry] of this.entries)
      if (entry.expires <= this.now()) this.entries.delete(id);
  }
  issue(value) {
    this.prune();
    while (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value);
    const id = randomBytes(24).toString('base64url');
    this.entries.set(id, { value, expires: this.now() + this.ttl });
    return id;
  }
  get(id) {
    this.prune();
    return this.entries.get(id)?.value;
  }
}

export class PreviewCache {
  constructor({
    pageMax = 256,
    pageTtl = 10 * 60_000,
    pageEntryBytes = 16 * 1024,
    mediaMax = 128,
    mediaTtl = 5 * 60_000,
    mediaBytes = 128 * 1024 * 1024,
    now = Date.now,
  } = {}) {
    Object.assign(this, {
      pageMax,
      pageTtl,
      pageEntryBytes,
      mediaMax,
      mediaTtl,
      mediaBytes,
      now,
    });
    this.pages = new Map();
    this.media = new Map();
    this.mediaSize = 0;
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.pages) if (entry.expires <= now) this.pages.delete(key);
    for (const [key, entry] of this.media) {
      if (entry.expires > now) continue;
      this.media.delete(key);
      this.mediaSize -= entry.bytes.length;
    }
  }

  getPage(url) {
    this.prune();
    const entry = this.pages.get(url);
    return entry ? structuredClone(entry.value) : undefined;
  }

  putPage(url, value) {
    this.prune();
    const snapshot = structuredClone(value);
    const size = Buffer.byteLength(JSON.stringify(snapshot));
    if (size > this.pageEntryBytes || this.pageMax < 1) return;
    this.pages.delete(url);
    while (this.pages.size >= this.pageMax) this.pages.delete(this.pages.keys().next().value);
    this.pages.set(url, { value: snapshot, expires: this.now() + this.pageTtl });
  }

  getMedia(key) {
    this.prune();
    const entry = this.media.get(key);
    if (!entry) return undefined;
    return { bytes: Buffer.from(entry.bytes), type: entry.type };
  }

  putMedia(key, bytes, type) {
    this.prune();
    const snapshot = Buffer.from(bytes);
    if (snapshot.length > this.mediaBytes || this.mediaMax < 1) return;
    const previous = this.media.get(key);
    if (previous) {
      this.media.delete(key);
      this.mediaSize -= previous.bytes.length;
    }
    while (this.media.size >= this.mediaMax || this.mediaSize + snapshot.length > this.mediaBytes) {
      const oldest = this.media.keys().next().value;
      if (oldest === undefined) return;
      const entry = this.media.get(oldest);
      this.media.delete(oldest);
      this.mediaSize -= entry.bytes.length;
    }
    this.media.set(key, {
      bytes: snapshot,
      type,
      expires: this.now() + this.mediaTtl,
    });
    this.mediaSize += snapshot.length;
  }
}

export class RateLimit {
  constructor({
    global = 120,
    source = 30,
    maxSources = 1024,
    window = 60_000,
    now = Date.now,
  } = {}) {
    Object.assign(this, { global, source, maxSources, window, now });
    this.sources = new Map();
    this.bucket = { count: 0, expires: 0 };
  }
  allow(source) {
    const now = this.now();
    for (const [key, value] of this.sources) if (value.expires <= now) this.sources.delete(key);
    if (this.bucket.expires <= now) this.bucket = { count: 0, expires: now + this.window };
    if (++this.bucket.count > this.global) return false;
    if (!this.sources.has(source)) {
      if (this.sources.size >= this.maxSources) return false;
      this.sources.set(source, { count: 0, expires: now + this.window });
    }
    return ++this.sources.get(source).count <= this.source;
  }
}
