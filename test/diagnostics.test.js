/* The part of a support report that gets read.
 *
 * buildReport gathers; these two decide what it means and say it in words. A wrong verdict is
 * worse than no verdict - it sends whoever is helping down the wrong path - so the checks are
 * pinned here rather than eyeballed once when they were written.
 */
const test = require('node:test');
const assert = require('node:assert');
const { buildReport, findProblems, renderSummary, renderDetailed } = require('../src/diagnostics');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

// A report with nothing wrong with it, which each test then breaks in exactly one way.
const healthy = () => ({
  generatedAt: '2026-08-09T12:00:00.000Z',
  app: { version: '2.0.0', platform: 'win32 10.0.26200 x64', uiLang: 'ru' },
  settings: { langSuffix: 'russian' },
  dota: {
    path: 'C:/dota/game', pathValid: true,
    detectedLang: { suffix: 'russian' },
    langFolders: [{ suffix: 'russian', modFiles: 14 }],
    activeVoiceInstalled: true,
  },
  patchAndSchema: { patched: true, schemaNeeded: false, schemaApplied: true },
  mirrors: [{ host: 'raw.githubusercontent.com', failures: 0 }],
  library: { totalRecords: 14, enabled: 14, disabled: 0, packs: 0, presets: 1, fileOverlaps: 0, byCategory: { heroes: 11 } },
  catalogCache: {},
  caches: { downloadCacheBytes: 1024, iconCacheBytes: 0 },
  disk: { freeBytes: 40 * 1024 ** 3 },
  dotaRunning: false,
});

test('a healthy install produces no verdicts at all', () => {
  assert.deepStrictEqual(findProblems(healthy()), []);
});

test('no game path is broken, not a note', () => {
  const r = healthy();
  r.dota.path = null;
  r.dota.pathValid = false;
  const p = findProblems(r);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].level, 'broken');
  assert.match(p[0].what, /not found/i);
});

test('installing into a folder the game does not mount is broken', () => {
  const r = healthy();
  r.dota.detectedLang.suffix = 'english';
  const p = findProblems(r).filter((x) => x.level === 'broken');
  assert.strictEqual(p.length, 1);
  assert.match(p[0].detail, /dota_english/);
  assert.match(p[0].detail, /dota_russian/);
});

test('an unpatched game is broken', () => {
  const r = healthy();
  r.patchAndSchema.patched = false;
  assert.ok(findProblems(r).some((x) => x.level === 'broken' && /not patched/i.test(x.what)));
});

test('mods left in another language folder are a note, not a failure', () => {
  const r = healthy();
  r.dota.langFolders.push({ suffix: 'english', modFiles: 3 });
  const p = findProblems(r);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].level, 'note');
  assert.match(p[0].what, /dota_english/);
});

test('all mirrors down is broken; some down is a note', () => {
  const all = healthy();
  all.mirrors = [{ host: 'a', failures: 3 }, { host: 'b', failures: 5 }];
  assert.ok(findProblems(all).some((x) => x.level === 'broken' && /every download mirror/i.test(x.what)));

  const some = healthy();
  some.mirrors = [{ host: 'a', failures: 3 }, { host: 'b', failures: 0 }];
  const p = findProblems(some);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].level, 'note');
});

test('a nearly full drive is broken', () => {
  const r = healthy();
  r.disk.freeBytes = 900 * 1024 ** 2;
  assert.ok(findProblems(r).some((x) => x.level === 'broken' && /free/i.test(x.what)));
});

test('the summary leads with the verdict and never prints JSON', () => {
  const ok = healthy();
  ok.problems = findProblems(ok);
  const clean = renderSummary(ok);
  assert.match(clean, /NOTHING LOOKS WRONG/);
  assert.ok(!clean.includes('{'), 'the short report is for a human, not a parser');

  const bad = healthy();
  bad.patchAndSchema.patched = false;
  bad.problems = findProblems(bad);
  const text = renderSummary(bad);
  assert.match(text, /BROKEN \(1\)/);
  assert.ok(text.indexOf('BROKEN') < text.indexOf('THE BASICS'), 'what is wrong comes first');
});

test('the detailed report carries every section and the mod list', () => {
  const r = healthy();
  r.installedMods = [{ i: 1, slot: 10, name: 'Gopo Pudge', categoryId: 'heroes', enabled: true }];
  r.problems = findProblems(r);
  const md = renderDetailed(r, { 'app.log': 'hello' });
  for (const heading of ['Verdicts', 'App and system', 'Settings', 'Dota', 'Library', 'Installed mods', 'Files in this archive']) {
    assert.ok(md.includes(`## ${heading}`), `missing section: ${heading}`);
  }
  assert.match(md, /Gopo Pudge/);
  assert.match(md, /app\.log/);
});


test('diagnostic report does not expose the account name', () => {
  const account = 'SECRET_ACCOUNT';
  const home = path.join(os.tmpdir(), account);
  const game = path.join(home, 'Dota 2 Mod Manager');

  const originalHome = os.homedir;
  os.homedir = () => home;

  try {
    const { report, files } = buildReport({
      settings: { all: () => ({ langSuffix: 'english', uiLang: 'en', dotaGamePath: game }) },
      library: { list: () => [], listPresets: () => [] },
      installer: { coverage: () => new Set(), downloadCacheSize: () => 0, slotNumber: () => 1 },
      schemaService: { state: () => ({}) },
      catalog: { cacheInfo: () => ({}) },
      app: { version: 'test', userDataDir: game },
    });

    const zip = new AdmZip();
    zip.addFile('report.json', Buffer.from(JSON.stringify(report)));
    zip.addFile('REPORT.md', Buffer.from(renderDetailed(report, files)));

    for (const [name, content] of Object.entries(files)) {
      zip.addFile(name, Buffer.from(content));
    }

    for (const entry of zip.getEntries()) {
      assert.ok(!entry.getData().toString().includes(account), `${entry.entryName} exposes account name`);
    }
  } finally {
    os.homedir = originalHome;
  }
});

/*
 * What the main process gathers has to reach the file.
 *
 * ipc-diagnostics.js collects an `extra` object and buildReport copies it into the report one
 * field at a time. The display list was added to the first on 2026-09-04, for the complaint that
 * a list "stops scrolling partway", and never to the second: no report ever carried it. The
 * graphics card, added on 2026-09-15, was dropped the same way, which is how the displays turned
 * up - by exporting a real report and finding neither in it. Every test above hands a finished
 * report to the renderers, so none of them could see a field that was gathered and then lost.
 *
 * Read as text on both sides, because building the gatherer needs Electron and the point is only
 * that the two lists of names agree.
 */
test('every field the main process gathers for the report is copied into it', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const gatherer = read('src/ipc-diagnostics.js');
  const builder = read('src/diagnostics.js');

  const at = gatherer.indexOf('extra: {');
  assert.ok(at > 0, 'ipc-diagnostics.js no longer passes an extra object; this test stopped reading');
  const open = gatherer.indexOf('{', at);
  let depth = 0;
  let end = open;
  for (let i = open; i < gatherer.length; i++) {
    if (gatherer[i] === '{') depth++;
    else if (gatherer[i] === '}') { depth -= 1; if (!depth) { end = i; break; } }
  }
  const body = gatherer.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const keys = [];
  depth = 0;
  let cur = '';
  for (const ch of body) {
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { keys.push(cur); cur = ''; continue; }
    cur += ch;
  }
  keys.push(cur);
  const names = keys.map((k) => (/^\s*([A-Za-z_$][\w$]*)\s*:/.exec(k) || [])[1]).filter(Boolean);
  assert.ok(names.length >= 6, `expected the extra fields, found ${names.join(', ')}`);

  const dropped = names.filter((n) => !new RegExp(`extra\\.${n}\\b`).test(builder));
  assert.deepStrictEqual(dropped, [], `gathered and never copied into the report: ${dropped.join(', ')}`);
});

test('the detailed report shows the screens and the graphics card when it has them', () => {
  const r = healthy();
  r.displays = [{ id: 1, primary: true, size: { width: 1366, height: 768 }, workArea: { width: 1366, height: 728 }, scaleFactor: 1.25 }];
  r.gpu = { featureStatus: { gpu_compositing: 'enabled' }, devices: [{ active: true, vendorId: 4318, driverVersion: '31.0.15' }] };
  r.problems = findProblems(r);
  const md = renderDetailed(r, {});
  assert.ok(md.includes('## Displays'), 'the display section is missing');
  assert.ok(md.includes('## Graphics card'), 'the graphics section is missing');
  assert.match(md, /1366/);
  assert.match(md, /gpu_compositing/);
});

test('a mod name with a pipe cannot break the table it is printed in', () => {
  const r = healthy();
  r.installedMods = [{ i: 1, slot: 10, name: 'a | b', categoryId: 'heroes', enabled: true }];
  r.problems = [];
  const row = renderDetailed(r, {}).split('\n').find((l) => l.includes('a /'));
  assert.ok(row, 'the pipe should have been replaced');
  assert.strictEqual(row.split('|').length, 7, 'six columns plus the closing bar');
});
