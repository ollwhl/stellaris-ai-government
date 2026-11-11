'use strict';
/**
 * Minimal, dependency-free MediaWiki wikitext -> readable plain text converter.
 * Tuned for the Stellaris Paradox Wiki (heavy use of {{iconify}}, wikitables,
 * {{version}}, and nested templates).
 */

// Templates whose content is pure navigation/meta noise -> drop entirely.
const DROP_TEMPLATES = new Set([
  'version', 'main', 'see also', 'seealso', 'clear', 'stub', 'toc', 'anchor',
  'navbox', 'navbar', 'hatnote', 'for', 'further', 'tooltip', 'wip',
  'sversion', 'mainarticle', 'stubsection', 'disambig', 'disambiguation',
]);

// Templates that wrap text in styling -> keep the inner text.
const WRAP_TEMPLATES = new Set([
  'yellow', 'green', 'red', 'plain', 'nowrap', 'hover', 'highlight',
  'good', 'bad', 'mild', 'colour', 'color', 'small', 'big',
]);

function replaceTemplates(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const open = text.indexOf('{{', i);
    if (open === -1) { out += text.slice(i); break; }
    out += text.slice(i, open);
    // find matching close, accounting for nesting
    let depth = 1;
    let j = open + 2;
    while (j < n && depth > 0) {
      if (text.startsWith('{{', j)) { depth++; j += 2; }
      else if (text.startsWith('}}', j)) { depth--; j += 2; }
      else j++;
    }
    if (depth !== 0) { // unbalanced - emit rest verbatim
      out += text.slice(open);
      break;
    }
    const inner = text.slice(open + 2, j - 2);
    out += renderTemplate(inner);
    i = j;
  }
  return out;
}

function renderTemplate(inner) {
  const raw = inner.trim();
  if (!raw) return '';
  // split top-level params on | (brace-aware)
  const parts = splitParams(raw);
  const name = (parts.shift() || '').trim().toLowerCase();
  if (DROP_TEMPLATES.has(name)) return '';

  // strip key= prefixes, keep values
  const values = parts
    .map((p) => {
      const eq = p.indexOf('=');
      // only treat as named param if the key looks like an identifier
      if (eq > 0 && /^[a-zA-Z_][a-zA-Z0-9_\s-]{0,30}$/.test(p.slice(0, eq))) {
        return p.slice(eq + 1).trim();
      }
      return p.trim();
    })
    .filter((p) => p.length > 0);

  if (name === 'icon' || name === 'iconify' || name === 'iconbox') {
    // {{iconify|alloys}} -> alloys ; icon name only, drop the numeric size arg
    return values.length ? values[0] : '';
  }
  if (WRAP_TEMPLATES.has(name)) return values.join(' ');

  if (!values.length) return '';
  return values.join(' ');
}

function splitParams(s) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (s.startsWith('{{', i) || s.startsWith('[[', i)) { depth++; cur += ch + (s[i + 1] || ''); i++; continue; }
    if (s.startsWith('}}', i) || s.startsWith(']]', i)) { depth--; cur += ch + (s[i + 1] || ''); i++; continue; }
    if (ch === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function renderLinks(text, extractLinks) {
  const links = [];
  let out = text.replace(/\[\[([^\]]*)\]\]/g, (m, inner) => {
    // skip files/images
    if (/^(file|image|category):/i.test(inner)) return '';
    const pipe = inner.indexOf('|');
    let target = pipe === -1 ? inner : inner.slice(0, pipe);
    const label = pipe === -1 ? inner : inner.slice(pipe + 1);
    // section anchors
    target = target.split('#')[0].trim();
    if (target) links.push(target);
    let lab = label;
    const lpipe = lab.indexOf('|');
    if (lpipe !== -1) lab = lab.slice(lpipe + 1);
    return lab.trim();
  });
  return { text: out, links };
}

/**
 * Flatten wikitable syntax into readable rows.
 *
 * A MediaWiki row is usually spread over many lines - one cell per line, and
 * cells often carry multi-line bullet lists. Emitting one output line per
 * source line produced unreadable, hard-to-retrieve text, so cells are
 * accumulated and flushed as a single " | "-joined line per row.
 */
function cleanTables(text) {
  const lines = text.split('\n');
  const out = [];
  let inTable = false;
  let row = [];

  const flush = () => {
    if (row.length) { out.push(row.join(' | ')); row = []; }
  };

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (trimmed.startsWith('{|')) { inTable = true; row = []; continue; }
    if (trimmed.startsWith('|}')) { flush(); inTable = false; out.push(''); continue; }
    if (!inTable) { out.push(line); continue; }

    // row separator / caption
    if (trimmed.startsWith('|-')) { flush(); continue; }
    if (trimmed.startsWith('|+')) { flush(); out.push(trimmed.slice(2).trim()); continue; }

    // a new cell (or several, via "!!" / "||")
    if (trimmed.startsWith('!') || trimmed.startsWith('|')) {
      const cells = splitCells(trimmed.slice(1));
      if (cells.length) row.push(...cells);
      continue;
    }

    // continuation of the previous cell (bullet lists, wrapped text)
    if (trimmed) {
      // A <br/> inside a cell becomes a newline before we get here, so the
      // remainder of the row - including its "||" separators - can arrive as
      // a continuation line. "||" always separates cells, whatever line it
      // sits on, so split it: first piece continues the current cell, the
      // rest start new ones.
      if (row.length && /\|\||!!/.test(trimmed)) {
        const parts = trimmed.split(/\|\||!!/);
        row[row.length - 1] += ' ' + parts[0].trim();
        for (let k = 1; k < parts.length; k++) {
          const cell = stripCellAttrs(parts[k].replace(/^\s*\|\s*/, ''));
          if (cell) row.push(cell);
        }
      } else if (row.length) {
        row[row.length - 1] += ' ' + trimmed;
      } else {
        out.push(trimmed);
      }
    }
  }
  flush();
  return out.join('\n');
}

/**
 * Strip a MediaWiki cell's HTML attribute prefix.
 *   'class="unsortable" | Effects'  -> 'Effects'
 *   'style="max-width:250px" |'     -> ''
 *   'Perfect habitability'          -> unchanged (no top-level bar)
 *
 * The prefix only counts as attributes when it actually looks like them:
 * it must contain '=' and must not contain wiki markup or be absurdly long.
 */
function stripCellAttrs(cell) {
  const bar = cell.indexOf('|');
  if (bar === -1) return cell.trim();
  const before = cell.slice(0, bar);
  const after = cell.slice(bar + 1);
  if (/=/.test(before) && !/[[\]{}<>]/.test(before) && before.length <= 200) {
    return after.trim();
  }
  return cell.trim();
}

function splitCells(s) {
  // MediaWiki allows both "!!"/"||" (same row) and a leading "|" (new cell on
  // its own line). Handle all three, then drop any attribute prefix.
  return s
    .split(/!!|\|\|/)
    .map((c) => stripCellAttrs(c.replace(/^\s*\|\s*/, '')))
    .filter((c) => c.length);
}

/**
 * Convert wikitext to plain text.
 * @returns {{text: string, links: string[], headings: {level:number,title:string}[]}}
 */
function toText(wikitext) {
  let t = String(wikitext || '');

  // comments, refs, nowiki
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>/g, '');
  t = t.replace(/<ref[\s\S]*?<\/ref>/g, '');
  t = t.replace(/<nowiki>([\s\S]*?)<\/nowiki>/g, '$1');
  t = t.replace(/<syntaxhighlight[\s\S]*?<\/syntaxhighlight>/g, '');
  t = t.replace(/<pre>[\s\S]*?<\/pre>/g, '');

  // extract headings before link rendering (labels are safe either way)
  const headings = [];
  t = t.replace(/^(={1,6})\s*(.*?)\s*\1\s*$/gm, (m, eqs, title) => {
    const level = eqs.length;
    const clean = title.replace(/'''?/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim();
    headings.push({ level, title: clean });
    return '\n' + '#'.repeat(level) + ' ' + clean + '\n';
  });

  // external links
  t = t.replace(/\[(?:https?:\/\/|mailto:)\S+\s+([^\]]*)\]/g, '$1');
  t = t.replace(/\[(?:https?:\/\/|mailto:)\S+\]/g, '');

  // templates first (so cell-separator pipes remain parseable)
  t = replaceTemplates(t);

  // links (collect outgoing)
  const { text: afterLinks, links } = renderLinks(t, true);
  t = afterLinks;

  // html
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/?(?:div|span|table|tr|td|th|p|ul|li|ol|gallery|section|small|font)[^>]*>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');

  // bold / italic
  t = t.replace(/'''''/g, '').replace(/'''/g, '').replace(/''/g, '');

  // entities
  t = t.replace(/&nbsp;/g, ' ')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&minus;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#160;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)));

  // lists
  t = t.replace(/^[*#:;]+[ ]?/gm, (m) => '- '.padEnd(2, ' '));

  // tables
  t = cleanTables(t);

  // indentation / whitespace
  t = t.replace(/^[ \t]+/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.split('\n').map((l) => l.trimEnd()).join('\n').trim();

  return { text: t, links: dedupe(links), headings };
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Plain-text extract with an optional character budget, respecting word bounds. */
function excerpt(text, maxChars) {
  if (!text) return '';
  if (!maxChars || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const idx = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return (idx > maxChars * 0.5 ? cut.slice(0, idx + 1) : cut) + '\n… [truncated - use stellaris_get_page with a section for more]';
}

/** Pull a specific section (by heading title, case-insensitive substring). */
function section(text, headingQuery) {
  const lines = text.split('\n');
  const q = String(headingQuery || '').toLowerCase().replace(/[#=]/g, '').trim();
  if (!q) return text;
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (start === -1) {
        if (m[2].toLowerCase().includes(q)) { start = i; level = m[1].length; }
      } else if (m[1].length <= level) {
        return lines.slice(start, i).join('\n').trim();
      }
    }
  }
  if (start !== -1) return lines.slice(start).join('\n').trim();
  return '';
}

module.exports = { toText, excerpt, section };
