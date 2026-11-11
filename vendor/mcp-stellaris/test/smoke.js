'use strict';
/**
 * Stdio smoke test for the stellaris-wiki MCP server.
 * Usage: node test/smoke.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const server = path.join(__dirname, '..', 'server.js');

// Run against a throwaway KB so the test never pollutes the real corpus.
const tmpKb = path.join(__dirname, '..', '..', '.tmp', 'smoke-kb');
fs.rmSync(tmpKb, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpKb, 'pages'), { recursive: true });
// pre-seed one transcript document so the video tools have something to find
fs.writeFileSync(path.join(tmpKb, 'pages', 'Video-_Test_Channel_-_Pop_Growth_Explained.json'), JSON.stringify({
  slug: 'Video-_Test_Channel_-_Pop_Growth_Explained',
  title: 'Video: Test Channel - Pop Growth Explained',
  text: 'Pop growth is driven by the number of pops already on the planet, by available housing, and by open jobs. Each month the game adds growth to a pool and when the pool fills a new pop appears.',
  links: [], headings: [{ level: 2, title: 'Pop Growth Explained' }],
  updated: new Date().toISOString(), bytes: 200,
  url: 'https://www.youtube.com/watch?v=TESTID&t=6393s',
  kind: 'transcript', sourceName: 'Test Video (Test Channel)',
  sourceUrl: 'https://www.youtube.com/watch?v=TESTID&t=6393s',
  startSec: 6393, endSec: 6500,
}));
const child = spawn(process.execPath, [server], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, STELLARIS_KB_DIR: tmpKb },
});

let buffer = '';
const pending = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buffer += d;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const SAMPLE = `
{{version|4.4}}
'''Empire size''' is a value that represents the overall size of an empire. Each {{iconify|colony}}, {{iconify|system}} and {{iconify|district}} adds to it.
== Overview ==
Empire size above 100 increases the cost of {{iconify|research}} and {{iconify|traditions}}.
=== Administrative efficiency ===
Administrative efficiency is produced by {{iconify|bureaucrat}} jobs and reduces effective empire size.
{| class="wikitable"
! Source !! Empire size
|-
| Colony || 10
|-
| System || 2
|}
== Reducing empire size ==
Taking the {{iconify|Expansion}} tradition tree reduces the penalty. See also [[Traditions]] and [[Jobs]].
<ref>Some reference</ref>
`;

(async () => {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  console.log('1. initialize ->', init.result.serverInfo.name, init.result.serverInfo.version);

  // 1b. Sandbox guard: the server must be bound to the throwaway KB, not the real one.
  // Without this, an ignored STELLARIS_KB_DIR silently writes test rows into
  // .kb/queue.json#done - which permanently blocks those titles from ever being
  // crawled (seed_queue.js skips anything in done).
  const guard = await rpc('tools/call', { name: 'stellaris_kb_stats', arguments: {} });
  const guardRoot = JSON.parse(guard.result.content[0].text).storageDir;
  if (!guardRoot || path.resolve(guardRoot) !== path.resolve(tmpKb)) {
    console.error('SANDBOX BREACH: server bound to', guardRoot, '- expected', tmpKb);
    console.error('Refusing to run: this would pollute the real queue and KB.');
    child.kill();
    process.exit(1);
  }
  console.log('1b. sandbox guard -> ok, isolated in', path.basename(tmpKb));

  const list = await rpc('tools/list', {});
  console.log('2. tools/list ->', list.result.tools.length, 'tools:', list.result.tools.map((t) => t.name).join(', '));

  const add = await rpc('tools/call', { name: 'stellaris_kb_add_page', arguments: { title: 'Empire size', wikitext: SAMPLE } });
  console.log('3. kb_add_page ->', JSON.stringify(JSON.parse(add.result.content[0].text)).slice(0, 200));

  const search = await rpc('tools/call', { name: 'stellaris_search', arguments: { query: 'administrative efficiency bureaucrat', limit: 5 } });
  const sr = JSON.parse(search.result.content[0].text);
  console.log('4. search ->', sr.count, 'hit(s); top =', sr.results[0] && sr.results[0].title, '| snippet:', sr.results[0] && sr.results[0].snippet.slice(0, 90));

  const explain = await rpc('tools/call', { name: 'stellaris_explain', arguments: { term: 'empire size' } });
  const er = JSON.parse(explain.result.content[0].text);
  console.log('5. explain -> matchType', er.pages[0] && er.pages[0].matchType, '| text head:', (er.pages[0] ? er.pages[0].text : '').slice(0, 120).replace(/\n/g, ' '));

  const outline = await rpc('tools/call', { name: 'stellaris_outline', arguments: { title: 'Empire size' } });
  const orr = JSON.parse(outline.result.content[0].text);
  console.log('6. outline ->', orr.headings.map((h) => '#'.repeat(h.level) + ' ' + h.title).join(' / '));

  const gloss = await rpc('tools/call', { name: 'stellaris_glossary', arguments: { term: 'ecum' } });
  const gr = JSON.parse(gloss.result.content[0].text);
  console.log('7. glossary "ecum" ->', gr.hits ? gr.hits.map((h) => h.term).join(', ') : 'MISS');

  const ui = await rpc('tools/call', { name: 'stellaris_ui_hint', arguments: { term: 'Naval Capacity' } });
  const ur = JSON.parse(ui.result.content[0].text);
  console.log('8. ui_hint ->', ur.mapped.map((m) => m.page).join(', ') || '(none)');

  const lp = await rpc('tools/call', { name: 'stellaris_learning_path', arguments: { path: 'economy' } });
  const lr = JSON.parse(lp.result.content[0].text);
  console.log('9. learning_path(economy) ->', lr.steps.length, 'steps, first =', lr.steps[0].page);

  const q = await rpc('tools/call', { name: 'stellaris_queue_add', arguments: { titles: ['Population', 'Jobs', 'Some modding page'], tier: 1 } });
  console.log('10. queue_add ->', JSON.parse(q.result.content[0].text).added, 'added');

  const qn = await rpc('tools/call', { name: 'stellaris_queue_next', arguments: { limit: 5 } });
  const qr = JSON.parse(qn.result.content[0].text);
  console.log('11. queue_next ->', qr.batch.map((b) => b.title).join(', '), '| remaining', qr.remaining);

  const st = await rpc('tools/call', { name: 'stellaris_kb_stats', arguments: {} });
  console.log('12. kb_stats ->', JSON.stringify(JSON.parse(st.result.content[0].text)).slice(0, 160));

  // ---- transcript support (the transcript doc was pre-seeded into tmpKb) ----
  const addVid = await rpc('tools/call', { name: 'stellaris_search', arguments: { query: 'pop growth housing', limit: 10 } });
  const av = JSON.parse(addVid.result.content[0].text);
  const sawTranscript = (av.results || []).some((r) => r.kind === 'transcript');
  console.log('13. transcript doc indexed ->', sawTranscript ? 'ok' : 'MISSING');

  const vs = await rpc('tools/call', { name: 'stellaris_video_search', arguments: { query: 'pop growth housing', limit: 3 } });
  const vsr = JSON.parse(vs.result.content[0].text);
  console.log('14. video_search ->', vsr.count, 'hit(s); top =', vsr.results[0] && vsr.results[0].title, '@', vsr.results[0] && vsr.results[0].timestamp, '|', vsr.results[0] && vsr.results[0].url);

  const vc = await rpc('tools/call', { name: 'stellaris_video_chapters', arguments: {} });
  const vcr = JSON.parse(vc.result.content[0].text);
  console.log('15. video_chapters ->', vcr.count, 'video(s)');

  const ex2 = await rpc('tools/call', { name: 'stellaris_explain', arguments: { term: 'pop growth' } });
  const ex2r = JSON.parse(ex2.result.content[0].text);
  console.log('16. explain w/ video ->', ex2r.video ? 'video hit: ' + ex2r.video[0].chapter + ' @ ' + ex2r.video[0].at : 'no video hit');

  const kf = await rpc('tools/call', { name: 'stellaris_search', arguments: { query: 'pop growth', limit: 3, kind: 'wiki' } });
  const kfr = JSON.parse(kf.result.content[0].text);
  console.log('17. search kind=wiki ->', kfr.count, 'hit(s), all wiki:', kfr.results.every((r) => r.kind === 'wiki'));

  child.kill();
  console.log('\nSMOKE TEST COMPLETE');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); child.kill(); process.exit(1); });
