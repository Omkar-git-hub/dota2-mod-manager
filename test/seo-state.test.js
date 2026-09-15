/* What the weekly search report carries from one week to the next.
 *
 * For a month every row of that report said "first week": the numbers were saved to a cache the
 * workflow never restored, and that GitHub would have evicted anyway, seven days being exactly
 * the gap between runs. The state now rides in the comment itself. These pin the two ways of
 * reading it back - the block, and for older reports their own tables - against the report that
 * was actually posted on 2026-09-14.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const load = () => import('../tools/seo-state.mjs');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'seo-comment-2026-09-14.md'), 'utf8');

test('a report from before the state block still gives back its headline numbers', async () => {
  const { stateFromTables } = await load();
  const s = stateFromTables(fixture);

  assert.deepEqual(s.bing, { clicks: 199, impressions: 1681 });
  assert.equal(s.bingIndex, 348);
  assert.equal(s.bingCrawled, 853);
  assert.deepEqual(s.google, { clicks: 1923, impressions: 14311, position: 6.2 });
  assert.equal(s.googlePages, 275);
  assert.deepEqual(s.yandex, { sqi: 10, inSearch: 360, excluded: 0 });
  assert.deepEqual(s.yandexTraffic, { shows: 5520, clicks: 879 });
});

test('the query tables come back too, so "new this week" can work on the first comparison', async () => {
  const { stateFromTables } = await load();
  const s = stateFromTables(fixture);
  for (const key of ['queries', 'gQueries', 'yQueries']) {
    assert.ok(s[key] && Object.keys(s[key]).length > 0, `${key} is empty`);
    const [first] = Object.values(s[key]);
    assert.equal(typeof first.i, 'number');
    assert.equal(typeof first.p, 'number');
  }
});

test('the state block survives the trip and wins over the tables', async () => {
  const { encodeState, previousState } = await load();
  const state = { google: { clicks: 1, impressions: 2, position: 3 }, gQueries: { 'dota 2 mods': { i: 9, p: 4.5 } } };
  const body = `${fixture}\n\n${encodeState(state)}\n`;
  assert.deepEqual(previousState(body), state, 'the block, not what the tables above it say');
});

test('the block is invisible in the rendered comment', async () => {
  const { encodeState } = await load();
  const line = encodeState({ a: 1 });
  assert.match(line, /^<!-- seo-state:v1 [A-Za-z0-9+/=]+ -->$/);
});

test('a comment that is not a report gives nothing, not a half-read state', async () => {
  const { previousState } = await load();
  assert.deepEqual(previousState('Thanks, looks good'), {});
  assert.deepEqual(previousState(''), {});
  assert.deepEqual(previousState('<!-- seo-state:v1 not-base64-gzip -->'), {});
});

test('click-through rate and position buckets', async () => {
  const { ctr, positionBuckets } = await load();
  assert.equal(ctr(1923, 14311), 13.4);
  assert.equal(ctr(5, 0), null);

  const b = positionBuckets([
    { position: 1.2, impressions: 100, clicks: 30 },
    { position: 6.8, impressions: 50, clicks: 5 },
    { position: 14, impressions: 20, clicks: 0 },
    { position: 40, impressions: 5, clicks: 0 },
    { position: 3.4, impressions: 10, clicks: 1 },
  ]);
  assert.deepEqual(b.map((x) => x.queries), [2, 1, 1, 1]);
  assert.equal(b[0].impressions, 110);
  assert.equal(b[0].clicks, 31);
});

test('a sitemap is counted by its addresses, not assumed', async () => {
  const { countLocs } = await load();
  assert.equal(countLocs('<urlset><url><loc>https://a/</loc></url><url><loc>https://a/b/</loc></url></urlset>'), 2);
  assert.equal(countLocs(''), 0);
});
