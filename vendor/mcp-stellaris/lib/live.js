'use strict';
/**
 * Live access to the Stellaris wiki.
 *
 * NOTE: stellaris.paradoxwikis.com sits behind F5 "Client Challenge" bot
 * protection. Plain HTTPS requests get a JS proof-of-work page instead of
 * content, so live calls usually return {blocked:true}. When that happens the
 * caller should fetch the same URL with the WebFetch tool (which passes the
 * challenge) and feed the wikitext back via stellaris_kb_add_page.
 */
const https = require('https');

const HOST = 'stellaris.paradoxwikis.com';
const UA = 'stellaris-teacher-mcp/1.0 (local knowledge base; +https://stellaris.paradoxwikis.com)';

function get(pathname, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: HOST, path: pathname, method: 'GET', timeout: timeoutMs,
        headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en' } },
      (res) => {
        // follow one redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(get(res.headers.location.startsWith('http') ? new URL(res.headers.location).pathname : res.headers.location, timeoutMs));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.end();
  });
}

function looksBlocked(body) {
  return /<title>\s*Client Challenge\s*<\/title>/i.test(body) || /_fs-ch-/.test(body.slice(0, 4000));
}

async function fetchRaw(title) {
  const r = await get('/index.php?title=' + encodeURIComponent(title.replace(/ /g, '_')) + '&action=raw');
  if (r.error) return { ok: false, blocked: false, error: r.error, title };
  if (r.status !== 200 || looksBlocked(r.body)) {
    return {
      ok: false, blocked: true, title,
      reason: 'stellaris.paradoxwikis.com returned the F5 bot-protection challenge for direct HTTP.',
      workaround: 'Call WebFetch on ' + rawUrl(title) + ' and pass the wikitext to stellaris_kb_add_page.',
      url: rawUrl(title),
    };
  }
  if (/^\s*#REDIRECT/i.test(r.body) || /^\s*#redirect/i.test(r.body)) {
    return { ok: true, redirect: true, raw: r.body.trim(), title };
  }
  return { ok: true, raw: r.body, title };
}

async function apiSearch(query, limit = 10) {
  const p = '/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&srlimit=' + limit + '&format=json';
  const r = await get(p);
  if (r.error) return { ok: false, blocked: false, error: r.error };
  if (r.status !== 200 || looksBlocked(r.body)) {
    return { ok: false, blocked: true, workaround: 'Use WebFetch on ' + 'https://' + HOST + p + ' and pipe results into the KB.' };
  }
  try {
    return { ok: true, results: JSON.parse(r.body).query.search };
  } catch (e) { return { ok: false, error: 'json parse failed' }; }
}

function rawUrl(title) {
  return 'https://' + HOST + '/index.php?title=' + encodeURIComponent(String(title).replace(/ /g, '_')) + '&action=raw';
}
function pageUrl(title) {
  return 'https://' + HOST + '/' + encodeURIComponent(String(title).replace(/ /g, '_'));
}

module.exports = { fetchRaw, apiSearch, rawUrl, pageUrl };
