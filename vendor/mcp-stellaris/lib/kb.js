'use strict';
/**
 * Local Stellaris knowledge base: stores wiki pages on disk and serves
 * BM25-ranked full-text search. Designed so that it degrades gracefully
 * when the corpus is small or empty.
 */
const fs = require('fs');
const path = require('path');
const { toText } = require('./wikitext');

const STOPWORDS = new Set(('a an and are as at be by can do does each for from get has have how if in into is it its of on or our so than that the their them then there these they this to under use used using was what when where which who why will with your you me my i'.split(' ')));

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9%+\-.]+/g, ' ')
    .split(' ')
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function slugify(title) {
  return String(title || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:*?"<>|#%[\]{}]/g, '-')
    .slice(0, 120);
}

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

function fmtTs(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
}

function urlFor(title) {
  return 'https://stellaris.paradoxwikis.com/' + encodeURIComponent(String(title || '').trim().replace(/ /g, '_'));
}

class KnowledgeBase {
  constructor(root) {
    this.root = root;
    this.pagesDir = path.join(root, 'pages');
    this.metaPath = path.join(root, 'meta.json');
    this.indexPath = path.join(root, 'index.json');
    this.queuePath = path.join(root, 'queue.json');
    this.docs = new Map();      // slug -> {title, text, links, headings, updated, bytes}
    this.titles = new Map();    // normalized title -> slug
    this.aliases = new Map();   // normalized alias -> slug
    this.index = new Map();     // token -> Map(slug -> tf)
    this.df = new Map();        // token -> doc frequency
    this.avgdl = 0;
    this.dirty = false;
    this.loaded = false;
  }

  // ---------- persistence ----------
  ensureDirs() {
    fs.mkdirSync(this.pagesDir, { recursive: true });
    if (!fs.existsSync(this.queuePath)) this.saveQueue({ tiers: {}, done: [], skipped: [] });
    if (!fs.existsSync(this.metaPath)) this.saveMeta({ created: new Date().toISOString(), pages: 0, version: 1 });
  }

  load() {
    if (this.loaded) return;
    this.ensureDirs();
    const files = fs.readdirSync(this.pagesDir).filter((f) => f.endsWith('.json'));
    let newestPage = 0;
    let newestIndex = fs.existsSync(this.indexPath) ? fs.statSync(this.indexPath).mtimeMs : -1;

    for (const f of files) {
      const st = fs.statSync(path.join(this.pagesDir, f));
      if (st.mtimeMs > newestPage) newestPage = st.mtimeMs;
    }

    if (files.length && newestIndex > newestPage && this.loadIndex()) {
      this.loaded = true;
      return;
    }
    for (const f of files) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(this.pagesDir, f), 'utf8'));
        if (doc && doc.title) this.register(doc, false);
      } catch (e) { /* skip corrupt */ }
    }
    this.loadAliases();
    this.buildIndex();
    if (files.length) this.saveIndex();
    this.loaded = true;
  }

  loadIndex() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      this.docs = new Map(raw.docs.map((d) => [d.slug, d]));
      this.index = new Map(raw.index.map(([tok, arr]) => [tok, new Map(arr)]));
      this.df = new Map(raw.df);
      this.avgdl = raw.avgdl || 0;
      for (const [slug, doc] of this.docs) this.titles.set(normTitle(doc.title), slug);
      this.loadAliases();
      return this.docs.size > 0;
    } catch (e) { return false; }
  }

  saveIndex() {
    const payload = {
      updated: new Date().toISOString(),
      docs: [...this.docs.values()].map((d) => ({
        slug: d.slug, title: d.title, text: d.text, links: d.links,
        headings: d.headings, updated: d.updated, bytes: d.bytes,
        url: d.url || urlFor(d.title), raw: d.raw,
        kind: d.kind || 'wiki', sourceName: d.sourceName || null,
        sourceUrl: d.sourceUrl || null,
        startSec: d.startSec === undefined ? null : d.startSec,
        endSec: d.endSec === undefined ? null : d.endSec,
      })),
      index: [...this.index].map(([tok, m]) => [tok, [...m]]),
      df: [...this.df],
      avgdl: this.avgdl,
    };
    fs.writeFileSync(this.indexPath, JSON.stringify(payload), 'utf8');
    this.saveMeta({ created: this.meta().created, pages: this.docs.size, updated: payload.updated, version: 1 });
  }

  meta() {
    try { return JSON.parse(fs.readFileSync(this.metaPath, 'utf8')); } catch (e) { return { created: new Date().toISOString(), pages: 0, version: 1 }; }
  }
  saveMeta(m) { fs.writeFileSync(this.metaPath, JSON.stringify(m, null, 2), 'utf8'); }
  loadQueue() {
    try { return JSON.parse(fs.readFileSync(this.queuePath, 'utf8')); } catch (e) { return { tiers: {}, done: [], skipped: [] }; }
  }
  saveQueue(q) { fs.writeFileSync(this.queuePath, JSON.stringify(q, null, 2), 'utf8'); }
  loadAliases() {
    const p = path.join(this.root, 'aliases.json');
    if (!fs.existsSync(p)) return;
    try {
      const a = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [alias, target] of Object.entries(a)) this.aliases.set(normTitle(alias), slugify(target));
    } catch (e) { /* ignore */ }
  }

  // ---------- ingestion ----------
  register(doc, reindex = true) {
    const slug = doc.slug || slugify(doc.title);
    doc.slug = slug;
    // Backfill docs stored before source metadata existed. Detect from the URL
    // rather than from the presence of raw wikitext - early wiki pages were
    // stored without it and would otherwise be mislabelled.
    if (!doc.kind) {
      const u = String(doc.url || doc.sourceUrl || '');
      doc.kind = /paradoxwikis\.com/i.test(u) ? 'wiki'
        : /youtube\.com|youtu\.be/i.test(u) ? 'transcript' : 'doc';
    }
    if (doc.kind === 'wiki' && !doc.sourceName) { doc.sourceName = 'Stellaris Wiki'; doc.sourceUrl = urlFor(doc.title); }
    if (doc.startSec === undefined) doc.startSec = null;
    if (doc.endSec === undefined) doc.endSec = null;
    this.docs.set(slug, doc);
    this.titles.set(normTitle(doc.title), slug);
    if (reindex) this.addToIndex(doc);
    this.dirty = true;
    return doc;
  }

  addToIndex(doc) {
    const tokens = tokenize(doc.title + ' ' + doc.title + ' ' + doc.text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, c] of tf) {
      let m = this.index.get(t);
      if (!m) { m = new Map(); this.index.set(t, m); }
      m.set(doc.slug, c);
      this.df.set(t, m.size);
    }
    doc.len = tokens.length;
  }

  buildIndex() {
    this.index = new Map();
    this.df = new Map();
    let total = 0;
    for (const doc of this.docs.values()) { this.addToIndex(doc); total += doc.len || 0; }
    this.avgdl = this.docs.size ? total / this.docs.size : 0;
  }

  /**
   * Store an already-plain-text document (transcript chunk, note, anything
   * that is not wikitext). `meta` carries source attribution:
   *   { kind, sourceName, sourceUrl, startSec, endSec }
   */
  upsertDoc(title, text, meta = {}, opts = {}) {
    // Always hydrate first. Callers may construct a KnowledgeBase and mutate
    // it without ever calling load() (e.g. scripts/ingest_inbox.js). Without
    // this, the in-memory doc map starts empty and flush() overwrites the
    // saved index with only the newly added docs, orphaning every other page.
    this.ensureDirs();
    this.load();
    const slug = slugify(title);
    const doc = {
      slug,
      title,
      text: String(text || ''),
      links: opts.links || [],
      headings: opts.headings || [],
      updated: new Date().toISOString(),
      bytes: Buffer.byteLength(String(text || ''), 'utf8'),
      url: meta.url || urlFor(title),
      kind: meta.kind || 'doc',
      sourceName: meta.sourceName || null,
      sourceUrl: meta.sourceUrl || null,
      startSec: meta.startSec === undefined ? null : meta.startSec,
      endSec: meta.endSec === undefined ? null : meta.endSec,
    };
    const existed = this.docs.has(slug);
    this.docs.set(slug, doc);
    this.titles.set(normTitle(title), slug);
    if (existed) this.buildIndex(); else { this.addToIndex(doc); this.avgdl = this.recomputeAvg(); }
    if (opts.aliases) for (const a of opts.aliases) this.aliases.set(normTitle(a), slug);
    fs.writeFileSync(path.join(this.pagesDir, slug + '.json'), JSON.stringify(doc), 'utf8');
    this.dirty = true;
    return doc;
  }

  /** Add or refresh a page from raw wikitext. Returns the stored doc summary. */
  upsertPage(title, wikitext, opts = {}) {
    // See upsertDoc - hydrate before mutating so we never clobber the index.
    this.ensureDirs();
    this.load();
    const parsed = toText(wikitext);
    const slug = slugify(title);
    const doc = {
      slug,
      title,
      text: parsed.text,
      links: parsed.links.slice(0, 400),
      headings: parsed.headings.slice(0, 200),
      updated: new Date().toISOString(),
      bytes: Buffer.byteLength(wikitext || '', 'utf8'),
      url: urlFor(title),
      raw: wikitext,
      kind: 'wiki',
      sourceName: 'Stellaris Wiki',
      sourceUrl: urlFor(title),
      startSec: null,
      endSec: null,
    };
    // replace existing -> rebuild the whole index so stale postings disappear
    const existed = this.docs.has(slug);
    this.docs.set(slug, doc);
    this.titles.set(normTitle(title), slug);
    if (existed) this.buildIndex(); else { this.addToIndex(doc); this.avgdl = this.recomputeAvg(); }
    if (opts.aliases) for (const a of opts.aliases) this.aliases.set(normTitle(a), slug);
    fs.writeFileSync(path.join(this.pagesDir, slug + '.json'), JSON.stringify(doc), 'utf8');
    this.dirty = true;
    return doc;
  }

  recomputeAvg() {
    let total = 0, n = 0;
    for (const d of this.docs.values()) { total += d.len || 0; n++; }
    return n ? total / n : 0;
  }

  flush() { if (this.dirty) { this.buildIndex(); this.saveIndex(); this.dirty = false; } }

  has(title) {
    const slug = slugify(title);
    return this.docs.has(slug) || this.titles.has(normTitle(title)) || this.aliases.has(normTitle(title));
  }

  resolve(titleOrSlug) {
    const n = normTitle(titleOrSlug);
    const slug = this.titles.get(n) || this.aliases.get(n);
    const resolved = slug && this.docs.has(slug) ? this.docs.get(slug)
      : (this.docs.has(slugify(titleOrSlug)) ? this.docs.get(slugify(titleOrSlug)) : null);
    if (resolved && !resolved.url) resolved.url = urlFor(resolved.title);
    return resolved;
  }

  // ---------- search ----------
  search(query, opts = {}) {
    this.load();
    const limit = Math.max(1, Math.min(50, opts.limit || 8));
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const N = this.docs.size || 1;
    const k1 = 1.5, b = 0.75;
    const scores = new Map();

    for (const qt of qTokens) {
      const postings = this.index.get(qt);
      // prefix expansion for partial words (e.g. "terrafor" -> "terraforming")
      const extra = [];
      if (!postings && qt.length >= 4) {
        for (const tok of this.index.keys()) if (tok.startsWith(qt)) extra.push(tok);
      }
      const lists = [];
      if (postings) lists.push(postings);
      for (const e of extra.slice(0, 6)) lists.push(this.index.get(e));

      for (const m of lists) {
        for (const [slug, tf] of m) {
          const doc = this.docs.get(slug);
          if (!doc) continue;
          const df = this.df.get(qt) || 1;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const dl = doc.len || 0;
          const denom = tf + k1 * (1 - b + b * (dl / (this.avgdl || 1)));
          let s = (idf * (tf * (k1 + 1))) / (denom || 1);
          scores.set(slug, (scores.get(slug) || 0) + s);
        }
      }
    }

    // title-match boost: exact, then prefix, then token overlap
    const nq = normTitle(query);
    for (const [slug, doc] of this.docs) {
      const nt = normTitle(doc.title);
      let boost = 0;
      if (nt === nq) boost = 12;
      else if (nt.startsWith(nq) || nq.startsWith(nt)) boost = 6;
      else {
        const dt = new Set(tokenize(doc.title));
        let hits = 0;
        for (const t of qTokens) if (dt.has(t)) hits++;
        boost = (hits / Math.max(1, qTokens.length)) * 4;
      }
      if (boost) scores.set(slug, (scores.get(slug) || 0) + boost);
    }

    const ranked = [...scores.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    const qTokensLower = tokenize(query);
    return ranked.map(([slug, score]) => {
      const doc = this.docs.get(slug);
      return {
        title: doc.title,
        score: Number(score.toFixed(3)),
        url: doc.url || urlFor(doc.title),
        kind: doc.kind || 'wiki',
        sourceName: doc.sourceName || null,
        sourceUrl: doc.sourceUrl || null,
        startSec: doc.startSec === undefined ? null : doc.startSec,
        endSec: doc.endSec === undefined ? null : doc.endSec,
        timestamp: doc.startSec === null || doc.startSec === undefined ? null : fmtTs(doc.startSec),
        updated: doc.updated,
        size: doc.bytes,
        snippet: snippet(doc.text, qTokensLower, opts.snippetChars || 320),
      };
    });
  }

  stats() {
    this.load();
    const byKind = {};
    for (const d of this.docs.values()) byKind[d.kind || 'doc'] = (byKind[d.kind || 'doc'] || 0) + 1;
    const q = this.loadQueue();
    const pending = Object.values(q.tiers || {}).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0);
    let chars = 0;
    for (const d of this.docs.values()) chars += (d.text || '').length;
    return {
      pages: this.docs.size,
      byKind,
      characters: chars,
      indexTokens: this.index.size,
      queuedTitles: pending,
      done: (q.done || []).length,
      metaUpdated: this.meta().updated || this.meta().created,
      storageDir: this.root,
    };
  }
}

function snippet(text, tokens, maxChars) {
  if (!text) return '';
  const lower = text.toLowerCase();
  let best = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  if (best === -1) best = 0;
  const start = Math.max(0, best - Math.floor(maxChars / 3));
  let s = text.slice(start, start + maxChars).replace(/\n+/g, ' ').trim();
  if (start > 0) s = '…' + s;
  if (start + maxChars < text.length) s = s + '…';
  return s;
}

module.exports = { KnowledgeBase, tokenize, slugify, normTitle, snippet, urlFor };
