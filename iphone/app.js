// ネットルーティン iPhone版
// 外部サイトの上にはナビを重ねられないため、この画面がナビの役目をする。
// サイトはブラウザで開き、見終わったらこのアプリに戻って次へ進む。
(function () {
  'use strict';
  const C = RoutineCore;
  const KEY_DATA = 'netRoutine.data';
  const KEY_STATE = 'netRoutine.state';
  const KEY_LAST = 'netRoutine.lastViewed'; // { siteId: アプリから最後に開いた日時 }（リセットしない）
  const KEY_FEED = 'netRoutine.feedStatus'; // { siteId: { url, channelId, latest, checkedAt, error } }
  const KEY_SERVER = 'netRoutine.feedServer'; // YouTube 新着チェック用の中継サーバーのURL
  const $ = (id) => document.getElementById(id);

  /* ---------- 保存（localStorage） ---------- */
  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      alert('保存できませんでした: ' + e.message);
    }
  }
  const loadData = () => readJson(KEY_DATA) || C.emptyData();
  const loadState = (data) => C.normalizeState(readJson(KEY_STATE), data, new Date());
  const getServer = () => localStorage.getItem(KEY_SERVER) || '';
  // 新着のない YouTube チャンネルは「次へ」などで飛ばす（中継サーバーを設定したときだけ）
  const getSkip = (data) => (getServer() ? C.computeFeedSkip(data, readJson(KEY_FEED), readJson(KEY_LAST)) : []);

  const KEY_OPENED = 'netRoutine.lastOpened'; // { siteId, url } 最後に開いたもの（「↗ 開く」で開き直す）

  // サイトを開く準備: 開くURLを決め、アプリから開いた日時を記録する（YouTube の新着判定の基準）
  // YouTube チャンネルに新着動画があれば、チャンネルページの代わりに新着動画を古い順に再生する
  function prepareOpen(site) {
    const lv = readJson(KEY_LAST) || {};
    const target = getServer() ? C.feedOpenTarget(site, (readJson(KEY_FEED) || {})[site.id], lv[site.id]) : null;
    lv[site.id] = target ? target.viewedAt : Date.now();
    writeJson(KEY_LAST, lv);
    const url = target ? target.url : site.url;
    writeJson(KEY_OPENED, { siteId: site.id, url });
    return url;
  }

  /* ---------- YouTube チャンネルの新着確認（中継サーバー経由） ---------- */
  const FEED_MIN_INTERVAL = 5 * 60 * 1000; // 同じチャンネルを5分以内に何度も確認しない
  let feedCheckRunning = null;

  async function checkOneFeed(server, site, prev) {
    const st = prev && prev.url === site.url ? Object.assign({}, prev) : { url: site.url };
    try {
      const u = new URL(server);
      u.searchParams.set('url', site.url);
      if (st.channelId) u.searchParams.set('channelId', st.channelId);
      const res = await fetch(u.href, { cache: 'no-store' });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      st.channelId = json.channelId;
      st.latest = typeof json.latest === 'number' ? json.latest : null;
      // 古い中継サーバーは動画一覧を返さない（そのときはチャンネルページを開く）
      st.videos = Array.isArray(json.videos) ? json.videos : null;
      st.error = null;
    } catch (e) {
      // 確認できなかったときは「新着あり」扱い（飛ばさない）
      st.latest = null;
      st.videos = null;
      st.error = String(e && e.message ? e.message : e);
    }
    st.checkedAt = Date.now();
    return st;
  }

  // 全チャンネルを確認する（同時に1回だけ）。force なら5分以内でも確認し直す
  function checkFeeds(force) {
    const server = getServer();
    if (!server) return Promise.resolve();
    if (feedCheckRunning) return feedCheckRunning;
    feedCheckRunning = (async () => {
      const old = readJson(KEY_FEED) || {};
      const next = {};
      const queue = C.flatten(loadData())
        .map((e) => e.site)
        .filter((s) => !s.noFeedCheck && C.isYouTubeChannelUrl(s.url));
      const worker = async () => {
        while (queue.length) {
          const site = queue.shift();
          const prev = old[site.id];
          const fresh = !force && prev && prev.url === site.url && !prev.error && prev.videos !== undefined && Date.now() - prev.checkedAt < FEED_MIN_INTERVAL;
          next[site.id] = fresh ? prev : await checkOneFeed(server, site, prev);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      writeJson(KEY_FEED, next);
      refreshScreen();
    })().finally(() => { feedCheckRunning = null; });
    return feedCheckRunning;
  }

  /* ---------- 操作 ---------- */
  function openSite(url) {
    // タップの処理中に同期で開く（ポップアップブロックを避ける）
    window.open(url, '_blank', 'noopener');
  }

  // ナビの直上にトーストを数秒出す
  let toastTimer = null;
  function showToast(text) {
    const t = $('toast');
    t.textContent = text;
    t.style.bottom = $('nav').getBoundingClientRect().height + 10 + 'px';
    t.hidden = false;
    // アニメーションをやり直す
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function act(action) {
    const data = loadData();
    const res = C.applyAction(data, loadState(data), action, new Date(), { skip: getSkip(data) });
    if (!res.noop) writeJson(KEY_STATE, res.state);
    if (res.entry) {
      openSite(prepareOpen(res.entry.site));
    }
    render();
    if (res.notice) {
      showToast(res.notice);
      lastNotice = { text: res.notice, at: Date.now() };
    }
  }

  // サイトを開くとアプリは裏に回るので、案内は戻ってきたときにもう一度出す
  let lastNotice = null;
  let pendingNotice = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (lastNotice && Date.now() - lastNotice.at < 2000) pendingNotice = lastNotice.text;
      lastNotice = null;
    } else if (pendingNotice) {
      showToast(pendingNotice);
      pendingNotice = null;
    }
  });

  function toggle(siteId) {
    const data = loadData();
    writeJson(KEY_STATE, C.toggleVisited(data, loadState(data), siteId, new Date(), { skip: getSkip(data) }));
    render();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- 描画 ---------- */
  // 円いチェックの見た目（PC版と同じ）
  //   巡回済み … 緑に白い ✓ / 新着なしで巡回済み … グレーに白い ✓ / 新着なしで未巡回 … グレーに黒い ✓
  function applyCheckLook(btn, visited, noNew, noNewVisited) {
    let cls = 'check';
    if (visited && noNewVisited) cls += ' on quiet';
    else if (visited) cls += ' on';
    else if (noNew) cls += ' quiet';
    btn.className = cls;
    btn.textContent = visited || noNew ? '✓' : '';
  }

  function renderList(v) {
    const list = $('list');
    if (v.total === 0) {
      const p = el('p', 'empty', 'サイトが登録されていません。右上の「編集」から登録するか、PC版で書き出した JSON を読み込んでください。');
      list.replaceChildren(p);
      return;
    }
    list.replaceChildren(
      ...v.categories.map((cat) => {
        const sec = el('section', 'cat');
        const h2 = el('h2');
        h2.append(el('span', '', cat.name), el('span', '', cat.visited + '/' + cat.total));
        sec.append(h2);
        cat.sites.forEach((s) => {
          const row = el('div', 'row' + (s.current ? ' current' : '') + (s.visited ? ' visited' : '') + (s.noNew ? ' nonew' : ''));
          row.dataset.site = s.id;
          const chk = el('button');
          applyCheckLook(chk, s.visited, s.noNew, s.noNewVisited);
          chk.setAttribute('aria-label', s.name + (s.visited ? ' のチェックを外す' : ' にチェックを付ける'));
          chk.addEventListener('click', () => toggle(s.id));
          const name = el('button', 'name', s.name);
          name.addEventListener('click', () => act({ type: 'goto', siteId: s.id }));
          row.append(chk, name);
          if (s.noNew) row.append(el('span', 'badge', '新着なし'));
          sec.append(row);
        });
        return sec;
      })
    );
  }

  function renderNav(v) {
    const cur = v.current;
    let title;
    let sub;
    if (v.total === 0) {
      title = 'サイトが登録されていません';
      sub = '右上の「編集」から登録してください';
    } else if (v.finished && v.remaining === 0 && cur) {
      // 完了後も「次へ」で進めるので、今のサイト名を出す
      title = cur.siteName;
      sub = '🎉 今日の巡回完了 ・ ' + cur.categoryName;
    } else if (v.finished) {
      title = v.remaining > 0 ? '巡回の最後まで来ました' : '🎉 今日の巡回完了';
      sub = v.remaining > 0 ? '未訪問 ' + v.remaining + '件（一覧から開けます）' : '全' + v.total + 'サイトをチェックしました';
    } else if (!cur) {
      title = v.visitedCount > 0 ? '続きから巡回' : '巡回を始めましょう';
      sub = '「次へ」で最初の未訪問サイトを開きます';
    } else {
      title = cur.siteName;
      sub = cur.categoryName + '（' + cur.catProgress.visited + '/' + cur.catProgress.total + '）・全体 ' + v.visitedCount + '/' + v.total;
      if (cur.noNew) sub += ' ・ 新着動画なし';
    }
    $('navTitle').textContent = title;
    $('navSub').textContent = sub;

    const chk = $('curCheck');
    chk.hidden = !cur;
    if (cur) applyCheckLook(chk, cur.visited, cur.noNew, cur.noNewVisited);
    const none = v.total === 0;
    $('prevBtn').disabled = !v.canPrev;
    $('openBtn').disabled = !cur;
    $('nextBtn').disabled = !v.canNext;
    $('nextCatBtn').disabled = !v.canNextCategory;
    $('listBtn').disabled = none;
    $('topProg').textContent = none ? '' : v.visitedCount + '/' + v.total + (v.noNewCount ? '（新着なし ' + v.noNewCount + '）' : '');
  }

  function render() {
    const data = loadData();
    const v = C.getView(data, loadState(data), new Date(), { skip: getSkip(data) });
    currentView = v;
    renderList(v);
    renderNav(v);
  }

  let currentView = null;

  $('curCheck').addEventListener('click', () => currentView && currentView.current && toggle(currentView.current.siteId));
  $('prevBtn').addEventListener('click', () => act({ type: 'prev' }));
  $('nextBtn').addEventListener('click', () => act({ type: 'next' }));
  $('nextCatBtn').addEventListener('click', () => act({ type: 'nextCategory' }));
  // もう一度開く: 最後に開いたもの（新着動画の再生リストなど）を開き直す
  $('openBtn').addEventListener('click', () => {
    const cur = currentView && currentView.current;
    if (!cur) return;
    const last = readJson(KEY_OPENED);
    openSite(last && last.siteId === cur.siteId ? last.url : cur.url);
  });
  $('listBtn').addEventListener('click', () => {
    const id = currentView && currentView.current && currentView.current.siteId;
    const row = id && document.querySelector('[data-site="' + id + '"]');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- 画面切り替え（巡回 ⇔ 編集） ---------- */
  let editor = null;
  function setMode(edit) {
    $('routineView').hidden = edit;
    $('nav').hidden = edit;
    $('editView').hidden = !edit;
    $('modeBtn').textContent = edit ? '完了' : '編集';
    $('title').textContent = edit ? 'サイトを編集' : 'ネットルーティン';
    window.scrollTo(0, 0);
    if (edit) {
      if (!editor) {
        editor = RoutineEditor.mount($('editor'), {
          load: loadData,
          save: (data) => writeJson(KEY_DATA, data),
          // コピー経由の登録: ブラウザの 共有→コピー でコピーした URL をクリップボードから読む
          getCurrentPage: async () => C.parseSharedText(await navigator.clipboard.readText()),
          grabLabels: {
            row: '貼り付け',
            rowTitle: 'コピーした URL をこの行に入れる',
            add: 'コピーしたURLを追加',
            addTitle: 'コピーした URL をこのカテゴリに追加する',
            error: 'コピーした URL が見つかりません。ブラウザの 共有 →「コピー」で URL をコピーしてから押してください',
          },
          // 中継サーバーを設定したときだけ、YouTube チャンネルの行に「新着チェック」を出す
          get feedToggle() { return !!getServer(); },
          feedInfo: (siteId) => C.describeFeedStatus((readJson(KEY_FEED) || {})[siteId], (readJson(KEY_LAST) || {})[siteId]),
        });
      } else {
        editor.reload();
      }
      renderServerSetting();
    } else {
      render();
    }
  }
  $('modeBtn').addEventListener('click', () => setMode($('editView').hidden));

  // 新着確認の結果が出たら、今の画面を描き直す（編集画面で入力中なら邪魔しない）
  function refreshScreen() {
    if ($('editView').hidden) return render();
    const a = document.activeElement;
    if (editor && !(a && /^(INPUT|TEXTAREA)$/.test(a.tagName))) editor.reload();
  }

  /* ---------- 中継サーバーの設定（編集画面） ---------- */
  function renderServerSetting() {
    const server = getServer();
    $('serverUrl').value = server;
    const targets = C.flatten(loadData()).filter((e) => C.isYouTubeChannelUrl(e.site.url)).length;
    $('serverStatus').textContent = server
      ? '設定済み。YouTube チャンネル ' + targets + '件を新着チェックします。'
      : '未設定（YouTube の新着チェックは行いません）';
  }
  $('serverSave').addEventListener('click', async () => {
    const v = $('serverUrl').value.trim();
    // https のみ（手元での動作確認用に http://localhost・127.0.0.1 も許可）
    if (v && !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])[^\s]+$/i.test(v)) {
      $('serverStatus').textContent = 'https:// で始まる URL を入れてください';
      return;
    }
    if (v) localStorage.setItem(KEY_SERVER, v);
    else localStorage.removeItem(KEY_SERVER);
    renderServerSetting();
    if (!v) return refreshScreen();
    $('serverStatus').textContent = '保存しました。新着を確認しています…';
    await checkFeeds(true);
    const st = Object.values(readJson(KEY_FEED) || {});
    const ng = st.filter((x) => x.error);
    $('serverStatus').textContent = st.length === 0
      ? '保存しました。YouTube チャンネルが登録されていません。'
      : '確認しました（' + st.length + '件中 成功 ' + (st.length - ng.length) + '件' + (ng.length ? '・失敗 ' + ng.length + '件：' + ng[0].error : '') + '）';
  });

  // ブラウザから戻ってきたとき・日付が変わったときに表示を更新し、新着も確認する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if ($('editView').hidden) render();
    checkFeeds();
  });
  window.addEventListener('pageshow', () => $('editView').hidden && render());
  // 開いている間は30分ごとに確認する
  setInterval(() => checkFeeds(), 30 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  render();
  checkFeeds();
})();
