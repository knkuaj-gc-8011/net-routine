// ネットルーティン iPhone版
// 外部サイトの上にはナビを重ねられないため、この画面がナビの役目をする。
// サイトはブラウザで開き、見終わったらこのアプリに戻って次へ進む。
(function () {
  'use strict';
  const C = RoutineCore;
  const KEY_DATA = 'netRoutine.data';
  const KEY_STATE = 'netRoutine.state';
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
    const res = C.applyAction(data, loadState(data), action, new Date());
    if (!res.noop) writeJson(KEY_STATE, res.state);
    if (res.entry) openSite(res.entry.site.url);
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
    writeJson(KEY_STATE, C.toggleVisited(data, loadState(data), siteId, new Date()));
    render();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- 描画 ---------- */
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
          const row = el('div', 'row' + (s.current ? ' current' : '') + (s.visited ? ' visited' : ''));
          row.dataset.site = s.id;
          const chk = el('button', 'check' + (s.visited ? ' on' : ''), s.visited ? '✓' : '');
          chk.setAttribute('aria-label', s.name + (s.visited ? ' のチェックを外す' : ' にチェックを付ける'));
          chk.addEventListener('click', () => toggle(s.id));
          const name = el('button', 'name', s.name);
          name.addEventListener('click', () => act({ type: 'goto', siteId: s.id }));
          row.append(chk, name);
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
    }
    $('navTitle').textContent = title;
    $('navSub').textContent = sub;

    const chk = $('curCheck');
    chk.hidden = !cur;
    if (cur) {
      chk.className = 'check' + (cur.visited ? ' on' : '');
      chk.textContent = cur.visited ? '✓' : '';
    }
    const none = v.total === 0;
    $('prevBtn').disabled = !v.canPrev;
    $('openBtn').disabled = !cur;
    $('nextBtn').disabled = !v.canNext;
    $('nextCatBtn').disabled = !v.canNextCategory;
    $('listBtn').disabled = none;
    $('topProg').textContent = none ? '' : v.visitedCount + '/' + v.total;
  }

  function render() {
    const data = loadData();
    const v = C.getView(data, loadState(data), new Date());
    currentView = v;
    renderList(v);
    renderNav(v);
  }

  let currentView = null;

  $('curCheck').addEventListener('click', () => currentView && currentView.current && toggle(currentView.current.siteId));
  $('prevBtn').addEventListener('click', () => act({ type: 'prev' }));
  $('nextBtn').addEventListener('click', () => act({ type: 'next' }));
  $('nextCatBtn').addEventListener('click', () => act({ type: 'nextCategory' }));
  $('openBtn').addEventListener('click', () => currentView && currentView.current && openSite(currentView.current.url));
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
        });
      } else {
        editor.reload();
      }
    } else {
      render();
    }
  }
  $('modeBtn').addEventListener('click', () => setMode($('editView').hidden));

  // ブラウザから戻ってきたとき・日付が変わったときに表示を更新する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('editView').hidden) render();
  });
  window.addEventListener('pageshow', () => $('editView').hidden && render());

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  render();
})();
