#!/usr/bin/env node
'use strict';
/**
 * stellaris-wiki - MCP server for the Stellaris Paradox Wiki.
 *
 * Zero dependencies. Speaks MCP over stdio (newline-delimited JSON-RPC).
 *
 * IMPORTANT NETWORK NOTE
 * ----------------------
 * stellaris.paradoxwikis.com is behind F5 "Client Challenge" bot protection,
 * so direct HTTPS from this server is normally blocked. The workflow is:
 *   1. stellaris_queue_next      -> titles that still need downloading
 *   2. WebFetch (the agent's own tool, which passes the challenge)
 *      on https://stellaris.paradoxwikis.com/index.php?title=<X>&action=raw
 *   3. stellaris_kb_add_page     -> store it, index it, done forever
 * Once a page is in the KB everything is instant and offline.
 */
const fs = require('fs');
const path = require('path');

const { KnowledgeBase, slugify, normTitle, tokenize } = require('./lib/kb');
const { toText, excerpt, section } = require('./lib/wikitext');
const live = require('./lib/live');

const KB_ROOT = process.env.STELLARIS_KB_DIR
  ? path.resolve(process.env.STELLARIS_KB_DIR)
  : path.resolve(__dirname, '..', '.kb');

const kb = new KnowledgeBase(KB_ROOT);

const DATA = path.join(__dirname, 'data');
function readData(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch (e) { return fallback; }
}
const GLOSSARY = readData('glossary.json', { entries: {} }).entries || {};
const UI_TERMS = readData('ui_terms.json', { terms: {} }).terms || {};
const PATHS = readData('learning_paths.json', { paths: {} }).paths || {};

// Pages that are noise for a *player* asking "what does this mean".
const SKIP_RE = /(modding|disambiguation|hotkey|^list of |^anomaly events?\b|^\d+\.\d+|voice set)/i;

function fmtTs(sec) {
  if (sec === null || sec === undefined) return null;
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
}

function out(s) { return { content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] }; }
function err(s) { return { content: [{ type: 'text', text: 'ERROR: ' + s }], isError: true }; }
function yaml(s) { return typeof s === 'string' ? s : JSON.stringify(s, null, 2); }

// ---------------------------------------------------------------- helpers
function digest(doc, maxChars) {
  return {
    title: doc.title,
    url: doc.url,
    updated: doc.updated,
    text: excerpt(doc.text, maxChars || 1600),
  };
}

function bestMatch(term, opts = {}) {
  const skipTranscript = !!opts.skipTranscript;
  const ok = (d) => d && !(skipTranscript && d.kind === 'transcript');
  const exact = kb.resolve(term);
  if (ok(exact)) return { doc: exact, how: 'exact' };
  const hits = kb.search(term, { limit: 8 });
  for (const h of hits) {
    if (h.score <= 1.5) break;
    const d = kb.resolve(h.title);
    if (ok(d)) return { doc: d, how: 'search', score: h.score };
  }
  return null;
}

function glossaryLookup(term) {
  const q = String(term || '').toLowerCase().trim();
  if (!q) return [];
  const res = [];
  for (const [k, v] of Object.entries(GLOSSARY)) {
    const kl = k.toLowerCase();
    if (kl === q) res.push({ term: k, meaning: v, match: 'exact' });
    else if (kl.split(/[\s/(]/)[0] === q) res.push({ term: k, meaning: v, match: 'abbrev' });
  }
  if (res.length) return res.slice(0, 5);
  const toks = tokenize(term);
  const scored = [];
  for (const [k, v] of Object.entries(GLOSSARY)) {
    const kt = tokenize(k);
    const hits = toks.filter((t) => kt.includes(t)).length;
    if (hits) scored.push({ term: k, meaning: v, match: 'partial', score: hits / Math.max(1, toks.length) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}

function uiLookup(term) {
  const q = normTitle(term);
  if (!q) return [];
  const res = [];
  for (const [k, page] of Object.entries(UI_TERMS)) {
    const kl = normTitle(k);
    if (kl === q) res.push({ ui: k, page, match: 'exact' });
    else if (kl.startsWith(q) || q.startsWith(kl)) res.push({ ui: k, page, match: 'prefix' });
    else if (q.includes(kl)) res.push({ ui: k, page, match: 'contains' });
  }
  const order = { exact: 0, prefix: 1, contains: 2 };
  return res.sort((a, b) => order[a.match] - order[b.match]).slice(0, 6);
}

function stalenessHint() {
  const s = kb.stats();
  if (s.pages === 0) {
    return 'KB IS EMPTY. No wiki pages are downloaded yet. To answer properly: call stellaris_queue_next, fetch each URL with WebFetch, then stellaris_kb_add_page. Do not guess mechanics from memory.';
  }
  if (s.pages < 300) {
    return `KB coverage is partial (${s.pages} pages). If nothing matches, do not guess - fetch the page live: WebFetch ${live.rawUrl('<Page_Title>')} and then stellaris_kb_add_page.`;
  }
  return null;
}

// ---------------------------------------------------------------- tools
const TOOLS = [
  {
    name: 'stellaris_explain',
    description: 'ONE-CALL answer to "what does X mean?". Searches the knowledge base, returns a digest of the best-matching wiki page(s) plus glossary and related-page hits. Use this first for any Stellaris term, UI label, resource, job, ship part, crisis or mechanic.',
    inputSchema: {
      type: 'object',
      properties: {
        term: { type: 'string', description: 'The thing to explain - a wiki term, UI label, abbreviation or free-text question.' },
        pages: { type: 'number', description: 'How many top pages to digest (default 2, max 4).' },
        maxChars: { type: 'number', description: 'Characters of text per page (default 1600).' },
      },
      required: ['term'],
    },
  },
  {
    name: 'stellaris_search',
    description: 'BM25 full-text search across every downloaded wiki page AND every video transcript chunk. Returns ranked titles with snippets, kind of source, and (for video) a timestamped deep link.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: { type: 'number', description: 'Max results (default 8, max 50).' },
        kind: { type: 'string', description: 'Filter: "wiki" or "transcript". Omit for both.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'stellaris_video_search',
    description: 'Search the Stellaris video transcripts in the KB. Returns the spoken content with a deep link straight to that moment in the video (e.g. &t=6393s). Use when a player would rather watch an explanation, or when the wiki page is too dry.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to find in the video, e.g. "pop growth", "how to build a starbase", "espionage".' },
        limit: { type: 'number', description: 'Max results (default 4).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'stellaris_video_chapters',
    description: 'List the chapters of an ingested video with timestamps and deep links. Use to point a player at the right section of a long tutorial.',
    inputSchema: { type: 'object', properties: { video: { type: 'string', description: 'Optional substring of the video title. Omit to list all ingested videos.' } } },
  },
  {
    name: 'stellaris_get_page',
    description: 'Fetch the full text of a wiki page from the local KB. Optionally narrow to one section by heading name.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact wiki page title, e.g. "Population".' },
        section: { type: 'string', description: 'Optional heading name (substring, case-insensitive) to return only that section.' },
        maxChars: { type: 'number', description: 'Truncate output to N characters (default 12000).' },
      },
      required: ['title'],
    },
  },
  {
    name: 'stellaris_outline',
    description: 'List the section headings of a page. Cheap way to see what a big page contains before reading it.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'stellaris_related',
    description: 'Pages linked from a given page (the "what should I read next" graph).',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, limit: { type: 'number' } },
      required: ['title'],
    },
  },
  {
    name: 'stellaris_glossary',
    description: 'Look up Stellaris slang and abbreviations (FE, AE, GC, ecum, naval cap, tall/wide, CG...). Explains community shorthand a new player will not know.',
    inputSchema: { type: 'object', properties: { term: { type: 'string', description: 'Slang or abbreviation. Leave empty for a random sample of the glossary.' } }, required: [] },
  },
  {
    name: 'stellaris_ui_hint',
    description: 'Map a UI label / tooltip / resource name seen in a screenshot to the wiki page that explains it. Call this when the user pastes a screenshot and you can read text off it.',
    inputSchema: { type: 'object', properties: { term: { type: 'string', description: 'Text visible in the UI, e.g. "Empire Size", "Naval Capacity", "Administrative Efficiency".' } }, required: ['term'] },
  },
  {
    name: 'stellaris_learning_path',
    description: 'Ordered reading list for a topic. Use when teaching a beginner or when the user asks "where do I start / how do I learn X".',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'One of: absolute-beginner, economy, warfare, expansion, midgame, lategame, gestalt. Omit to list all.' },
      },
    },
  },
  {
    name: 'stellaris_kb_stats',
    description: 'Knowledge base coverage: how many pages are downloaded, indexed tokens, and how many titles are still queued.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stellaris_kb_add_page',
    description: 'Store a wiki page into the local KB from raw wikitext. Call this right after fetching https://stellaris.paradoxwikis.com/index.php?title=<X>&action=raw with WebFetch. The page becomes searchable instantly and offline.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact wiki page title.' },
        wikitext: { type: 'string', description: 'Raw wikitext (the action=raw output).' },
        aliases: { type: 'array', items: { type: 'string' }, description: 'Optional alternate names that should resolve to this page.' },
      },
      required: ['title', 'wikitext'],
    },
  },
  {
    name: 'stellaris_queue_next',
    description: 'Get the next batch of wiki page titles that still need to be downloaded. Drives the crawling cron job.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Batch size (default 6).' } },
    },
  },
  {
    name: 'stellaris_queue_add',
    description: 'Add titles to the download queue, optionally into a priority tier (1 = highest).',
    inputSchema: {
      type: 'object',
      properties: {
        titles: { type: 'array', items: { type: 'string' } },
        tier: { type: 'number', description: '1 = core pages, 2 = normal, 3 = deep/obscure (default 2).' },
      },
      required: ['titles'],
    },
  },
  {
    name: 'stellaris_live_fetch',
    description: 'Attempt a live download of a wiki page. Usually returns blocked:true because of the site bot challenge; when it does, follow the returned workaround (WebFetch + stellaris_kb_add_page).',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'stellaris_readme',
    description: 'Read the MCP server README: architecture, the bot-challenge workaround, and the teaching contract for answering player questions.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function callTool(name, args) {
  const a = args || {};
  switch (name) {
    case 'stellaris_explain': {
      kb.load();
      const term = String(a.term || '').trim();
      if (!term) return err('term is required');
      const n = Math.max(1, Math.min(4, a.pages || 2));
      const result = { term, glossary: glossaryLookup(term), ui: uiLookup(term), pages: [], hint: stalenessHint() };

      // Exact term wins; the UI mapping is only a fallback seed.
      const uiTop = result.ui.find((u) => u.match === 'exact' || u.match === 'prefix');
      const seedTitles = [term];
      if (uiTop) seedTitles.push(uiTop.page);

      // pages = written reference (wiki); transcripts get their own section below
      let added = 0;
      const seen = new Set();
      for (const seed of seedTitles) {
        const m = bestMatch(seed, { skipTranscript: true });
        if (m && !seen.has(m.doc.slug)) {
          seen.add(m.doc.slug);
          result.pages.push({ ...digest(m.doc, a.maxChars || 1600), matchedVia: seed, matchType: m.how });
          added++;
        }
        if (added >= n) break;
      }
      if (added < n) {
        for (const h of kb.search(term, { limit: n * 4 })) {
          if (seen.has(slugify(h.title))) continue;
          if (h.kind === 'transcript') continue;
          const d = kb.resolve(h.title);
          if (!d) continue;
          seen.add(d.slug);
          result.pages.push({ ...digest(d, a.maxChars || 1600), matchType: 'search', score: h.score });
          if (++added >= n) break;
        }
      }
      if (result.pages.length) {
        const d0 = kb.resolve(result.pages[0].title);
        result.related = result.pages[0].related = d0 ? (d0.links || []).slice(0, 12) : [];
      }

      // Best matching spoken explanation from an ingested video.
      const vidHits = kb.search(term, { limit: 40, snippetChars: 620 })
        .filter((h) => h.kind === 'transcript' && h.startSec !== null && !seen.has(slugify(h.title)))
        .slice(0, 2);
      if (vidHits.length) {
        result.video = vidHits.map((h) => ({
          chapter: h.title.replace(/^Video: /, '').replace(/\s*\(part \d+\/\d+\)$/, ''),
          at: h.timestamp,
          watch: h.url,
          source: h.sourceName,
          says: h.snippet,
        }));
      }
      if (!result.pages.length && !result.glossary.length) {
        result.notFound = true;
        result.nextAction = `Not in the local KB. Fetch it: WebFetch ${live.rawUrl(term)} then call stellaris_kb_add_page. If the title is wrong, WebFetch ${'https://stellaris.paradoxwikis.com/api.php?action=query&list=search&srsearch=' + encodeURIComponent(term) + '&srlimit=8&format=json'} to find the real title.`;
      }
      return out(yaml(result));
    }

    case 'stellaris_search': {
      kb.load();
      let hits = kb.search(String(a.query || ''), { limit: a.limit || 8 });
      if (a.kind) hits = hits.filter((h) => h.kind === a.kind);
      return out(yaml({ query: a.query, count: hits.length, hint: hits.length ? null : stalenessHint(), results: hits }));
    }

    case 'stellaris_video_search': {
      kb.load();
      const limit = Math.max(1, Math.min(15, a.limit || 4));
      const all = kb.search(String(a.query || ''), { limit: 60, snippetChars: 700 });
      const hits = all.filter((h) => h.kind === 'transcript' && h.startSec !== null).slice(0, limit);
      return out(yaml(hits.length
        ? { query: a.query, count: hits.length, results: hits }
        : { query: a.query, count: 0, note: 'No transcript match. Try stellaris_search without a kind filter - the wiki may cover it.' }));
    }

    case 'stellaris_video_chapters': {
      kb.load();
      const needle = String(a.video || '').toLowerCase();
      const videos = new Map();
      for (const d of kb.docs.values()) {
        if (d.kind !== 'transcript' || !d.sourceName) continue;
        if (/full transcript index/i.test(d.title)) continue;   // the ToC doc is not a chapter
        if (needle && !d.sourceName.toLowerCase().includes(needle)) continue;
        if (!videos.has(d.sourceName)) videos.set(d.sourceName, { video: d.sourceName, url: (d.sourceUrl || '').replace(/&t=\d+s$/, ''), chapters: [] });
        videos.get(d.sourceName).chapters.push({ timestamp: fmtTs(d.startSec), startSec: d.startSec, title: (d.headings && d.headings[0] ? d.headings[0].title : d.title), url: d.url });
      }
      const list = [...videos.values()].map((v) => ({ ...v, chapters: v.chapters.sort((x, y) => x.startSec - y.startSec) }));
      return out(yaml({ videos: list, count: list.length }));
    }

    case 'stellaris_get_page': {
      kb.load();
      const doc = kb.resolve(a.title);
      if (!doc) {
        const hits = kb.search(a.title, { limit: 5 });
        return out(yaml({
          notFound: true, title: a.title,
          suggestions: hits.map((h) => h.title),
          nextAction: `WebFetch ${live.rawUrl(
            (hits[0] && hits[0].title) || a.title
          )} then stellaris_kb_add_page.`,
        }));
      }
      let text = doc.text;
      if (a.section) {
        const s = section(text, a.section);
        text = s || text;
        if (!s) {
          return out(yaml({
            title: doc.title, sectionNotFound: a.section,
            availableSections: (doc.headings || []).map((h) => h.title),
            text: excerpt(text, a.maxChars || 12000),
          }));
        }
      }
      return out(yaml({
        title: doc.title, url: doc.url, updated: doc.updated,
        kind: doc.kind || 'wiki',
        source: doc.sourceName || null,
        timestamp: fmtTs(doc.startSec),
        sections: (doc.headings || []).length,
        text: excerpt(text, a.maxChars || 12000),
      }));
    }

    case 'stellaris_outline': {
      kb.load();
      const doc = kb.resolve(a.title);
      if (!doc) return out(yaml({ notFound: true, title: a.title, suggestions: kb.search(a.title, { limit: 5 }).map((h) => h.title) }));
      return out(yaml({ title: doc.title, url: doc.url, headings: doc.headings || [], characters: (doc.text || '').length }));
    }

    case 'stellaris_related': {
      kb.load();
      const doc = kb.resolve(a.title);
      if (!doc) return out(yaml({ notFound: true, title: a.title }));
      const limit = a.limit || 20;
      const links = (doc.links || []).slice(0, limit);
      const inKb = links.filter((l) => kb.has(l));
      const missing = links.filter((l) => !kb.has(l));
      return out(yaml({ title: doc.title, inKb, missingFromKb: missing.slice(0, 15) }));
    }

    case 'stellaris_glossary': {
      const term = String(a.term || '').trim();
      if (!term) {
        const all = Object.entries(GLOSSARY);
        const sample = all.sort(() => 0.5 - Math.random()).slice(0, 12).map(([k, v]) => ({ term: k, meaning: v }));
        return out(yaml({ note: 'Sample of the glossary. Pass a term to look it up.', count: all.length, sample }));
      }
      const hits = glossaryLookup(term);
      return out(yaml(hits.length ? { term, hits } : { term, notFound: true, note: 'Not slang - try stellaris_explain.' }));
    }

    case 'stellaris_ui_hint': {
      const term = String(a.term || '').trim();
      const hits = uiLookup(term);
      const resolved = [];
      for (const h of hits.slice(0, 3)) {
        const d = kb.resolve(h.page);
        resolved.push({ ui: h.ui, match: h.match, page: h.page, url: live.pageUrl(h.page), inKb: !!d, quickText: d ? excerpt(d.text, 500) : null });
      }
      const kbHits = kb.search(term, { limit: 5 }).map((r) => ({ title: r.title, score: r.score, url: r.url }));
      return out(yaml({ term, mapped: resolved, kbFallback: kbHits, hint: (!resolved.length && !kbHits.length) ? stalenessHint() : null }));
    }

    case 'stellaris_learning_path': {
      const key = String(a.path || '').trim();
      if (!key) {
        return out(yaml({ available: Object.entries(PATHS).map(([k, v]) => ({ key: k, title: v.title, audience: v.audience })) }));
      }
      const p = PATHS[key];
      if (!p) return out(yaml({ notFound: true, available: Object.keys(PATHS) }));
      const steps = p.steps.map((s) => ({ ...s, url: live.pageUrl(s.page), inKb: kb.has(s.page) }));
      return out(yaml({ key, title: p.title, audience: p.audience, steps }));
    }

    case 'stellaris_kb_stats': {
      const s = kb.stats();
      const q = kb.loadQueue();
      return out(yaml({ ...s, tiers: Object.fromEntries(Object.entries(q.tiers || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])), hint: stalenessHint() }));
    }

    case 'stellaris_kb_add_page': {
      const title = String(a.title || '').trim();
      if (!title) return err('title is required');
      if (!a.wikitext || String(a.wikitext).trim().length < 20) return err('wikitext is empty - did WebFetch return the raw page?');
      const doc = kb.upsertPage(title, String(a.wikitext), { aliases: a.aliases });
      // remove from queue
      const q = kb.loadQueue();
      for (const t of Object.keys(q.tiers || {})) q.tiers[t] = (q.tiers[t] || []).filter((x) => normTitle(x) !== normTitle(title));
      if (!q.done) q.done = [];
      q.done.push(title);
      kb.saveQueue(q);
      return out(yaml({
        stored: true, title: doc.title, slug: doc.slug, url: doc.url,
        characters: (doc.text || '').length, rawBytes: doc.bytes,
        headingCount: (doc.headings || []).length, linkCount: (doc.links || []).length,
        kbTotal: kb.docs.size,
      }));
    }

    case 'stellaris_queue_next': {
      kb.load();
      const limit = Math.max(1, Math.min(30, a.limit || 6));
      const q = kb.loadQueue();
      q.tiers = q.tiers || {};
      const done = new Set((q.done || []).map(normTitle));
      const picked = [];
      for (const tier of ['1', '2', '3']) {
        const list = q.tiers[tier] || [];
        while (list.length && picked.length < limit) {
          const t = list.shift();
          if (!t) break;
          if (done.has(normTitle(t))) continue;
          if (kb.has(t)) { done.add(normTitle(t)); continue; }
          if (SKIP_RE.test(t)) continue;
          picked.push({ title: t, tier: Number(tier), url: live.rawUrl(t), pageUrl: live.pageUrl(t) });
        }
        q.tiers[tier] = list;
        if (picked.length >= limit) break;
      }
      kb.saveQueue(q);
      return out(yaml({
        batch: picked,
        remaining: Object.values(q.tiers).reduce((n, l) => n + (l ? l.length : 0), 0),
        done: (q.done || []).length,
        instructions: picked.length
          ? 'For each item: WebFetch the url (it returns raw wikitext), then call stellaris_kb_add_page with title + the wikitext. Do all of them in this run.'
          : 'Queue empty. Seed it with stellaris_queue_add, or fetch https://stellaris.paradoxwikis.com/api.php?action=query&list=allpages&aplimit=max&apnamespace=0&format=json via WebFetch and add the titles.',
      }));
    }

    case 'stellaris_queue_add': {
      const titles = (a.titles || []).map((t) => String(t).trim()).filter(Boolean);
      if (!titles.length) return err('titles is required');
      const q = kb.loadQueue();
      q.tiers = q.tiers || {};
      const tier = String(a.tier || 2);
      q.tiers[tier] = q.tiers[tier] || [];
      const existing = new Set(q.tiers[tier].map(normTitle));
      let added = 0;
      for (const t of titles) {
        if (existing.has(normTitle(t)) || kb.has(t)) continue;
        q.tiers[tier].push(t);
        added++;
      }
      kb.saveQueue(q);
      return out(yaml({ added, tier: Number(tier), queued: q.tiers[tier].length }));
    }

    case 'stellaris_live_fetch': {
      return live.fetchRaw(String(a.title || '')).then((r) => out(yaml(r)));
    }

    case 'stellaris_readme': {
      const p = path.join(__dirname, 'README.md');
      if (!fs.existsSync(p)) return out('README.md missing at ' + p);
      return out(fs.readFileSync(p, 'utf8'));
    }

    default:
      return err('Unknown tool: ' + name);
  }
}

// ---------------------------------------------------------------- stdio MCP
let buf = '';
function handle(msg) {
  const { id, method, params } = msg;
  const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');

  if (method === 'initialize') {
    return send({ id, result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false }, resources: {} }, serverInfo: { name: 'stellaris-wiki', version: '1.0.0' } } });
  }
  if (method === 'notifications/initialized' || (method || '').startsWith('notifications/')) return;
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const r = callTool(params.name, params.arguments);
    if (r && typeof r.then === 'function') return r.then((v) => send({ id, result: v }));
    return send({ id, result: r });
  }
  if (method === 'resources/list') {
    return send({
      id,
      result: {
        resources: [
          { uri: 'stellaris://readme', name: 'stellaris-wiki README', description: 'Architecture, bot-challenge workaround, teaching contract.', mimeType: 'text/markdown' },
          { uri: 'stellaris://glossary', name: 'Stellaris slang glossary', mimeType: 'application/json' },
        ],
      },
    });
  }
  if (method === 'resources/read') {
    const uri = params.uri;
    if (uri === 'stellaris://readme') {
      const p = path.join(__dirname, 'README.md');
      return send({ id, result: { contents: [{ uri, mimeType: 'text/markdown', text: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'missing' }] } });
    }
    if (uri === 'stellaris://glossary') {
      return send({ id, result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(GLOSSARY, null, 2) }] } });
    }
    return send({ id, error: { code: -32001, message: 'Unknown resource ' + uri } });
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: 'Method not found: ' + method } });
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { process.stderr.write('parse error: ' + e.message + '\n'); }
  }
});
process.stdin.on('end', () => process.exit(0));

process.on('uncaughtException', (e) => process.stderr.write('uncaught: ' + (e && e.stack) + '\n'));
