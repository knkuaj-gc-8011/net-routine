// 共通ロジックのテスト（node --test tests/ で実行）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../shared/core.js');

// テスト用データ: 3カテゴリ・計6サイト
function sample() {
  return {
    version: 1,
    categories: [
      { id: 'c1', name: 'ニュース', sites: [{ id: 'a', name: 'A', url: 'https://a.example/' }, { id: 'b', name: 'B', url: 'https://b.example/' }] },
      { id: 'c2', name: 'SNS', sites: [{ id: 'c', name: 'C', url: 'https://c.example/' }, { id: 'd', name: 'D', url: 'https://d.example/' }] },
      { id: 'c3', name: 'その他', sites: [{ id: 'e', name: 'E', url: 'https://e.example/' }, { id: 'f', name: 'F', url: 'https://f.example/' }] },
    ],
  };
}
const NOW = new Date(2026, 10, 22, 9, 0); // 2026-11-22 09:00

// 一連の操作を適用し、最後の結果を返す
function run(data, actions, state) {
  let s = state || C.emptyState(NOW);
  let res;
  for (const a of actions) {
    res = C.applyAction(data, s, typeof a === 'string' ? { type: a } : a, NOW);
    s = res.state;
  }
  return res;
}

test('getDayKey: 午前5時で日付が切り替わる', () => {
  assert.equal(C.getDayKey(new Date(2026, 10, 22, 4, 59)), '2026-11-21');
  assert.equal(C.getDayKey(new Date(2026, 10, 22, 5, 0)), '2026-11-22');
  assert.equal(C.getDayKey(new Date(2026, 10, 22, 23, 59)), '2026-11-22');
  assert.equal(C.getDayKey(new Date(2026, 10, 23, 0, 30)), '2026-11-22');
  assert.equal(C.getDayKey(new Date(2027, 0, 1, 3, 0)), '2026-12-31');
});

test('normalizeState: 日付が変わるとチェックが消える', () => {
  const data = sample();
  const old = { dayKey: '2026-11-21', visited: ['a', 'b'], currentSiteId: 'b', finished: false };
  const s = C.normalizeState(old, data, NOW);
  assert.deepEqual(s.visited, []);
  assert.equal(s.currentSiteId, null);
  // 同じ日なら残る。存在しないIDは取り除かれる
  const s2 = C.normalizeState({ dayKey: '2026-11-22', visited: ['a', 'zzz'], currentSiteId: 'zzz' }, data, NOW);
  assert.deepEqual(s2.visited, ['a']);
  assert.equal(s2.currentSiteId, null);
});

test('start: 最初の未訪問サイトから始まり、自動でチェックされる', () => {
  const data = sample();
  const state = { dayKey: '2026-11-22', visited: ['a', 'c'], currentSiteId: null };
  const res = run(data, ['start'], state);
  assert.equal(res.entry.site.id, 'b');
  assert.deepEqual(res.state.visited.sort(), ['a', 'b', 'c']);
});

test('next: チェック済みを飛ばして次の未訪問へ進む', () => {
  const data = sample();
  const state = { dayKey: '2026-11-22', visited: ['b', 'c'], currentSiteId: null };
  const res = run(data, ['start', 'next'], state);
  assert.equal(res.entry.site.id, 'd');
});

test('next: 全部チェックすると完了。最後のサイトで「次へ」→最初のサイトへ（案内あり）', () => {
  const data = sample();
  const done = run(data, ['start', 'next', 'next', 'next', 'next', 'next']);
  const v = C.getView(data, done.state, NOW);
  assert.equal(v.finished, true);
  assert.equal(v.remaining, 0);
  assert.equal(v.current.siteId, 'f');
  assert.equal(v.canNext, true);
  assert.equal(done.notice, null, '途中では案内なし');
  const res = C.applyAction(data, done.state, { type: 'next' }, NOW);
  assert.equal(res.entry.site.id, 'a');
  assert.match(res.notice, /最初のサイト/);
});

test('完了後: 「次へ」は一覧の順で1つ次、「次カテゴリ」は次カテゴリの先頭へ。最後のカテゴリなら最初のカテゴリへ', () => {
  const data = sample();
  const all = { dayKey: '2026-11-22', visited: ['a', 'b', 'c', 'd', 'e', 'f'], currentSiteId: 'a' };
  let res = run(data, ['next'], all);
  assert.equal(res.entry.site.id, 'b');
  res = run(data, ['next', 'next'], all);
  assert.equal(res.entry.site.id, 'c');
  res = run(data, ['nextCategory'], all);
  assert.equal(res.entry.site.id, 'c');
  res = run(data, ['nextCategory', 'nextCategory'], all);
  assert.equal(res.entry.site.id, 'e');
  assert.equal(res.notice, null);
  res = run(data, ['nextCategory', 'nextCategory', 'nextCategory'], all);
  assert.equal(res.entry.site.id, 'a');
  assert.match(res.notice, /最初のカテゴリ/);
  // 現在位置がない状態で完了していたら、最初のサイトから（案内なし）
  res = run(data, ['next'], Object.assign({}, all, { currentSiteId: null }));
  assert.equal(res.entry.site.id, 'a');
  assert.equal(res.notice, null);
});

test('未完了: 後ろに未巡回がなければ「次へ」は未巡回の最初のサイトへ（案内あり）', () => {
  const data = sample();
  // a,c,e を見て b,d,f を飛ばし、最後のサイト f の位置にいる
  const state = { dayKey: '2026-11-22', visited: ['a', 'c', 'e', 'f'], currentSiteId: 'f' };
  const res = run(data, ['next'], state);
  assert.equal(res.entry.site.id, 'b');
  assert.match(res.notice, /未巡回の最初のサイト/);
});

test('nextCategory: 次カテゴリの最初の未訪問へ。飛ばしたサイトは未チェック', () => {
  const data = sample();
  const res = run(data, ['start', 'nextCategory']);
  assert.equal(res.entry.site.id, 'c');
  assert.deepEqual(res.state.visited, ['a', 'c']);
  // 次カテゴリの先頭がチェック済みなら、その次の未訪問へ
  const res2 = run(data, ['start', 'nextCategory'], { dayKey: '2026-11-22', visited: ['c'], currentSiteId: null });
  assert.equal(res2.entry.site.id, 'd');
});

test('nextCategory: 未完了で最後のカテゴリなら、未巡回の最初のサイトへ（案内あり）', () => {
  const data = sample();
  // a → c → e と各カテゴリの先頭だけ見た後、さらに次カテゴリ
  const res = run(data, ['start', 'nextCategory', 'nextCategory', 'nextCategory']);
  assert.equal(res.entry.site.id, 'b');
  assert.match(res.notice, /未巡回の最初のサイト/);
  const v = C.getView(data, res.state, NOW);
  assert.equal(v.remaining, 2); // d, f
});

test('prev: 一覧順で1つ前へ（チェック状態は問わない）。先頭では何もしない', () => {
  const data = sample();
  const res = run(data, ['start', 'nextCategory', 'prev']);
  assert.equal(res.entry.site.id, 'b');
  const first = run(data, ['start', 'prev']);
  assert.equal(first.noop, true);
  assert.equal(first.state.currentSiteId, 'a');
});

test('goto: 指定サイトへ移動してチェック', () => {
  const data = sample();
  const res = run(data, [{ type: 'goto', siteId: 'e' }]);
  assert.equal(res.entry.site.id, 'e');
  assert.deepEqual(res.state.visited, ['e']);
});

test('toggleVisited: 手動で付け外しできる', () => {
  const data = sample();
  let s = C.toggleVisited(data, C.emptyState(NOW), 'd', NOW);
  assert.deepEqual(s.visited, ['d']);
  s = C.toggleVisited(data, s, 'd', NOW);
  assert.deepEqual(s.visited, []);
});

test('getView: 進捗と現在位置', () => {
  const data = sample();
  const res = run(data, ['start', 'next', 'next']);
  const v = C.getView(data, res.state, NOW);
  assert.equal(v.visitedCount, 3);
  assert.equal(v.total, 6);
  assert.equal(v.current.siteId, 'c');
  assert.equal(v.current.categoryName, 'SNS');
  assert.deepEqual([v.current.catProgress.visited, v.current.catProgress.total], [1, 2]);
  assert.equal(v.canPrev, true);
});

test('normalizeUrl', () => {
  assert.equal(C.normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(C.normalizeUrl(' http://x.jp/a '), 'http://x.jp/a');
  assert.equal(C.normalizeUrl('javascript:alert(1)'), null);
  assert.equal(C.normalizeUrl(''), null);
});

test('編集: 追加・更新・移動・削除', () => {
  let d = C.addCategory(C.emptyData(), 'ニュース');
  d = C.addCategory(d, 'SNS');
  const [c1, c2] = d.categories;
  let r = C.addSite(d, c1.id, '', 'news.example');
  assert.equal(r.ok, true);
  d = r.data;
  const site = d.categories[0].sites[0];
  assert.equal(site.name, 'news.example');
  assert.equal(C.addSite(d, c1.id, 'x', 'ftp://bad').ok, false);
  r = C.updateSite(d, site.id, { name: 'ニュースサイト' });
  d = r.data;
  assert.equal(d.categories[0].sites[0].name, 'ニュースサイト');
  // カテゴリの端から下へ動かすと次のカテゴリの先頭へ
  d = C.moveSite(d, site.id, 1);
  assert.equal(d.categories[0].sites.length, 0);
  assert.equal(d.categories[1].sites[0].id, site.id);
  d = C.moveCategory(d, c2.id, -1);
  assert.equal(d.categories[0].id, c2.id);
  d = C.removeSite(d, site.id);
  assert.equal(d.categories[0].sites.length, 0);
  d = C.removeCategory(d, c1.id);
  assert.equal(d.categories.length, 1);
});

test('skip: 新着なしのサイトは「次へ」「次カテゴリ」「開始」で飛ばし、完了判定では済み扱い', () => {
  const data = sample();
  const opts = { skip: ['b', 'c'] };
  const go = (actions, state) => {
    let s = state || C.emptyState(NOW);
    let res;
    for (const a of actions) { res = C.applyAction(data, s, typeof a === 'string' ? { type: a } : a, NOW, opts); s = res.state; }
    return res;
  };
  assert.equal(go(['start']).entry.site.id, 'a');
  assert.equal(go(['start', 'next']).entry.site.id, 'd', 'b と c を飛ばす');
  assert.equal(go(['start', 'nextCategory']).entry.site.id, 'd', '次カテゴリの先頭 c も飛ばす');
  // 飛ばしたものはチェックされない
  const r = go(['start', 'next']);
  assert.deepEqual(r.state.visited, ['a', 'd']);
  // 残り e,f を見たら完了（b,c は新着なしで済み扱い）
  const done = go(['start', 'next', 'next', 'next']);
  const v = C.getView(data, done.state, NOW, opts);
  assert.equal(v.remaining, 0);
  assert.equal(v.finished, true);
  assert.equal(v.noNewCount, 2);
  assert.equal(v.categories[0].sites[1].noNew, true);
  // 完了後は「次へ」で一覧の順に進む（新着なしも含めて）
  const after = C.applyAction(data, Object.assign({}, done.state, { currentSiteId: 'a' }), { type: 'next' }, NOW, opts);
  assert.equal(after.entry.site.id, 'b');
  // 一覧からは開ける
  assert.equal(go([{ type: 'goto', siteId: 'c' }]).entry.site.id, 'c');
});

test('YouTube: チャンネルURLの判定', () => {
  assert.deepEqual(C.youTubeChannelRef('https://www.youtube.com/@NHK'), { pageUrl: 'https://www.youtube.com/@NHK' });
  assert.deepEqual(C.youTubeChannelRef('https://www.youtube.com/@NHK/videos'), { pageUrl: 'https://www.youtube.com/@NHK' });
  assert.deepEqual(C.youTubeChannelRef('https://m.youtube.com/c/foo/featured'), { pageUrl: 'https://www.youtube.com/c/foo' });
  assert.deepEqual(C.youTubeChannelRef('https://youtube.com/channel/UCabcdefghijklmnopqrstuv'), { channelId: 'UCabcdefghijklmnopqrstuv' });
  assert.equal(C.youTubeChannelRef('https://www.youtube.com/watch?v=xyz'), null);
  assert.equal(C.youTubeChannelRef('https://www.youtube.com/'), null);
  assert.equal(C.youTubeChannelRef('https://example.com/@foo'), null);
});

test('YouTube: チャンネルIDの取り出しとフィードの最新日時', () => {
  const html = '<html><link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"></html>';
  assert.equal(C.extractChannelId(html), 'UCabcdefghijklmnopqrstuv');
  assert.equal(C.extractChannelId('{"externalId":"UCzzzzzzzzzzzzzzzzzzzzzz"}'), 'UCzzzzzzzzzzzzzzzzzzzzzz');
  assert.equal(C.extractChannelId('<html></html>'), null);
  const xml = `<feed><published>2010-01-01T00:00:00+00:00</published>
    <entry><id>1</id><published>2026-11-20T10:00:00+00:00</published></entry>
    <entry><id>2</id><published>2026-11-22T08:30:00+00:00</published></entry>
    <entry><id>3</id><published>2026-11-21T00:00:00+00:00</published></entry></feed>`;
  assert.equal(C.parseYouTubeFeedLatest(xml), Date.parse('2026-11-22T08:30:00+00:00'), 'チャンネル自体の published は無視');
  assert.equal(C.parseYouTubeFeedLatest('<feed><published>2010-01-01T00:00:00Z</published></feed>'), null);
});

test('YouTube: computeFeedSkip', () => {
  const data = {
    categories: [{ id: 'c', name: 'YT', sites: [
      { id: 'y1', name: '1', url: 'https://www.youtube.com/@one' },
      { id: 'y2', name: '2', url: 'https://www.youtube.com/@two' },
      { id: 'y3', name: '3', url: 'https://www.youtube.com/@three' },
      { id: 'y4', name: '4', url: 'https://www.youtube.com/@four', noFeedCheck: true },
      { id: 'w', name: 'web', url: 'https://example.com/' },
    ] }],
  };
  const status = { y1: { latest: 100 }, y2: { latest: 300 }, y3: { latest: 100 }, y4: { latest: 100 }, w: { latest: 100 } };
  const viewed = { y1: 200, y2: 200, y4: 200, w: 200 }; // y3 は一度も開いていない
  assert.deepEqual(C.computeFeedSkip(data, status, viewed), ['y1']);
  // 確認できていない（latest なし）なら飛ばさない
  assert.deepEqual(C.computeFeedSkip(data, { y1: { latest: null, error: 'x' } }, viewed), []);
});

test('noFeedCheck は編集・書き出し・読み込みで保たれる', () => {
  let d = C.addCategory(C.emptyData(), 'YT');
  d = C.addSite(d, d.categories[0].id, 'a', 'https://www.youtube.com/@a').data;
  const id = d.categories[0].sites[0].id;
  d = C.updateSite(d, id, { noFeedCheck: true }).data;
  assert.equal(d.categories[0].sites[0].noFeedCheck, true);
  const back = C.validateImport(C.exportJson(d)).data;
  assert.equal(back.categories[0].sites[0].noFeedCheck, true);
  d = C.updateSite(d, id, { noFeedCheck: false }).data;
  assert.equal('noFeedCheck' in d.categories[0].sites[0], false);
});

test('parseSharedText: コピーした文字から URL とタイトルを取り出す', () => {
  assert.deepEqual(C.parseSharedText('https://news.yahoo.co.jp/'), { title: '', url: 'https://news.yahoo.co.jp/' });
  assert.deepEqual(C.parseSharedText('Yahoo!ニュース\nhttps://news.yahoo.co.jp/topics'), { title: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/topics' });
  assert.deepEqual(C.parseSharedText('  https://a.example/x?y=1  '), { title: '', url: 'https://a.example/x?y=1' });
  assert.equal(C.parseSharedText('ただの文字'), null);
  assert.equal(C.parseSharedText(''), null);
});

test('書き出し→読み込みで内容が保たれる', () => {
  const json = C.exportJson(sample());
  const r = C.validateImport(json);
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.data.categories.map((c) => [c.name, c.sites.map((s) => s.url)]),
    sample().categories.map((c) => [c.name, c.sites.map((s) => s.url)])
  );
  assert.equal(C.validateImport('{bad').ok, false);
  assert.equal(C.validateImport({ categories: [{ name: 'x', sites: [{ url: 'javascript:1' }] }] }).ok, false);
});

test('配布用の core.js / editor.js が shared の正本と一致している', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['core.js', 'editor.js', 'editor.css']) {
    const src = fs.readFileSync(path.join(root, 'shared', f), 'utf8');
    for (const dir of ['extension', 'iphone']) {
      const copy = fs.readFileSync(path.join(root, dir, f), 'utf8');
      assert.equal(copy, src, `${dir}/${f} が古いです。scripts/sync-core.ps1 を実行してください`);
    }
  }
});
