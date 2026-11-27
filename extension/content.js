// ネットルーティン PC版 ナビバー
// 巡回タブのときだけ、ページ下部に Shadow DOM でナビバーを重ねる（サイトのCSSと干渉させないため）。
(() => {
  if (window.top !== window || window.__netRoutineNav) return;
  window.__netRoutineNav = true;

  let host = null;
  let shadow = null;
  let view = null;
  let collapsed = false;
  let listOpen = false;
  let editMenuOpen = false;
  let menuError = null;
  let toast = null; // { text, until }
  let shownToastAt = null; // 同じ案内を二度出さないため
  const TOAST_MS = 3500;
  let autoOn = false; // ナビの「自動巡回ON」（保存して全ページ共通）
  let autoTimer = null; // { siteId, left（残り秒）, handle }

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return null; // 拡張機能が再読み込みされた等
    }
  }

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  // 一覧の開閉はページをまたいで保つため保存する
  function setListOpen(v) {
    listOpen = v;
    return chrome.storage.local.set({ navListOpen: v }).catch(() => {});
  }

  // keepList: 一覧からサイトを選んだときは、移動後も一覧を開いたままにする
  async function act(type, extra, keepList) {
    editMenuOpen = false;
    if (!keepList && listOpen) await setListOpen(false);
    const v = await send({ cmd: 'action', action: Object.assign({ type }, extra || {}) });
    applyView(v);
  }

  function toggle(siteId) {
    send({ cmd: 'toggle', siteId }).then(applyView);
  }

  // 編集メニューから「編集画面」または「サイドパネル」を開く
  async function openEditor(cmd) {
    const res = await send({ cmd });
    if (res && res.ok) {
      editMenuOpen = false;
      menuError = null;
    } else {
      menuError = '開けませんでした' + (res && res.error ? '：' + res.error : '');
    }
    render();
  }

  async function setCollapsed(v) {
    collapsed = v;
    editMenuOpen = false;
    await setListOpen(false);
    await chrome.storage.local.set({ navCollapsed: v });
    render();
  }

  /* ---------- 自動巡回: 自動巡回のカテゴリでは、表示秒数ごとに「次へ」と同じ動きをする ---------- */
  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer.handle);
    autoTimer = null;
  }

  // 今のサイトに合わせてカウントダウンを始める・止める（同じサイトのまま再描画しても数え直さない）
  function syncAuto() {
    const cur = view && view.current;
    if (!autoOn || !cur || !cur.autoSeconds) return stopAuto();
    if (autoTimer && autoTimer.siteId === cur.siteId) return;
    stopAuto();
    autoTimer = { siteId: cur.siteId, left: cur.autoSeconds, handle: setInterval(tickAuto, 1000) };
  }

  function tickAuto() {
    if (!autoTimer) return;
    // タブが見えていない間・編集メニューを開いている間は止めておく
    if (document.visibilityState !== 'visible' || editMenuOpen) return;
    autoTimer.left -= 1;
    if (autoTimer.left <= 0) {
      stopAuto();
      act('next', null, true); // 一覧の開閉はそのまま
      return;
    }
    const el = shadow && shadow.querySelector('.auto-left');
    if (el) el.textContent = autoLeftText();
  }

  const autoLeftText = () => (autoTimer ? 'あと' + autoTimer.left + '秒' : '');

  async function setAutoOn(v) {
    autoOn = v;
    await chrome.storage.local.set({ autoTour: v }).catch(() => {});
    syncAuto();
    render();
  }

  function autoCheck(cur) {
    const sec = cur && cur.autoSeconds;
    return h('label', {
      class: 'auto' + (autoOn ? ' on' : ''),
      title: sec
        ? 'このカテゴリは ' + sec + ' 秒ごとに次のサイトへ自動で進みます'
        : '「自動巡回」を設定したカテゴリで、表示秒数ごとに次のサイトへ自動で進みます（設定は編集画面のカテゴリで）',
    }, [
      h('input', { type: 'checkbox', checked: autoOn, onchange: (e) => setAutoOn(e.target.checked) }),
      '自動巡回ON',
      autoTimer ? h('span', { class: 'auto-left' }, autoLeftText()) : null,
    ]);
  }

  function destroy() {
    stopAuto();
    if (host) host.remove();
    host = null;
    shadow = null;
  }

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('net-routine-nav');
    host.style.cssText = 'all: initial; position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    // CSP が厳しいサイトでも効くよう、<style> ではなく構築済みスタイルシートで当てる
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
    document.documentElement.appendChild(host);
  }

  function applyView(v) {
    if (!v || !v.isRoutineTab) return destroy();
    view = v;
    syncAuto();
    render();
  }

  async function refresh() {
    const r = await chrome.storage.local.get(['navCollapsed', 'navListOpen', 'navToast', 'autoTour']).catch(() => ({}));
    collapsed = !!r.navCollapsed;
    autoOn = !!r.autoTour;
    listOpen = !!r.navListOpen;
    // 最初に戻ったときの案内（ページ移動の直後に出せるよう、少しの間だけ有効）
    const t = r.navToast;
    if (t && t.at !== shownToastAt && Date.now() - t.at < 5000) {
      shownToastAt = t.at;
      toast = { text: t.text, until: Date.now() + TOAST_MS };
      setTimeout(() => { toast = null; render(); }, TOAST_MS);
    }
    applyView(await send({ cmd: 'view' }));
  }

  function statusText(v) {
    if (v.total === 0) return { title: 'サイトが登録されていません', sub: '拡張機能のアイコン → 編集 から登録してください' };
    if (v.finished && v.remaining === 0 && v.current) {
      // 完了後も「次へ」で進めるので、今のサイト名を出す
      return { title: v.current.siteName, sub: '🎉 今日の巡回完了 ・ ' + v.current.categoryName };
    }
    if (v.finished) {
      return v.remaining > 0
        ? { title: '巡回の最後まで来ました', sub: '未訪問 ' + v.remaining + '件（一覧から開けます）' }
        : { title: '🎉 今日の巡回完了', sub: '全' + v.total + 'サイトをチェックしました' };
    }
    if (!v.current) return { title: '巡回を始めましょう', sub: '「次へ」で最初の未訪問サイトを開きます' };
    const cp = v.current.catProgress;
    const noNew = v.current.noNew ? ' ・ 新着動画なし' : '';
    return { title: v.current.siteName, sub: v.current.categoryName + '（' + cp.visited + '/' + cp.total + '）' + noNew };
  }

  // 円いチェックの見た目
  //   巡回済み … 緑に白い ✓ / 新着なしで巡回済み … グレーに白い ✓ / 新着なしで未巡回 … グレーに黒い ✓
  function checkButton(siteId, visited, noNew, noNewVisited) {
    let cls = 'check';
    let title = visited ? 'チェックを外す' : 'チェックを付ける';
    if (visited && noNewVisited) {
      cls += ' on quiet';
      title = '新着なしで巡回済み（押すとチェックを外す）';
    } else if (visited) {
      cls += ' on';
    } else if (noNew) {
      cls += ' quiet';
      title = '新着なしのため飛ばします（押すとチェックを付ける）';
    }
    return h('button', { class: cls, title, onclick: () => toggle(siteId) }, visited || noNew ? '✓' : '');
  }

  // 一覧: カテゴリごとに縦4行まで。5つ目以降は右の列へ。はみ出したら横スクロール
  function listPanel(v) {
    const panel = h('div', { class: 'panel' },
      v.categories.map((cat) =>
        h('section', null, [
          h('h4', null, [cat.name, h('span', { class: 'muted' }, ' ' + cat.visited + '/' + cat.total)]),
          h('div', { class: 'sites' }, cat.sites.map((s) =>
            h('div', { class: 'row' + (s.current ? ' current' : '') + (s.noNew ? ' nonew' : '') }, [
              checkButton(s.id, s.visited, s.noNew, s.noNewVisited),
              h('button', {
                class: 'link',
                title: s.url + (s.noNew ? '\n新着動画なし（「次へ」では飛ばします）' : ''),
                onclick: () => act('goto', { siteId: s.id }, true),
              }, s.name),
              s.noNew ? h('span', { class: 'badge', title: '前回開いた後に新しい動画がありません' }, '新着なし') : null,
            ])
          )),
        ])
      )
    );
    // マウスホイールの縦回転でも横にスクロールする
    panel.addEventListener('wheel', (e) => {
      if (panel.scrollWidth <= panel.clientWidth || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      panel.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    return panel;
  }

  let lastScrollLeft = 0;
  let lastCurrentId = null;

  // 再描画しても横スクロール位置を保ち、今のサイトが変わったら見える位置までスクロールする
  function restoreListScroll(v) {
    const panel = shadow.querySelector('.panel');
    if (!panel) return;
    panel.scrollLeft = lastScrollLeft;
    const curId = v.current ? v.current.siteId : null;
    const row = shadow.querySelector('.panel .row.current');
    if (row && curId !== lastCurrentId) {
      const left = row.offsetLeft - panel.offsetLeft;
      if (left < panel.scrollLeft || left + row.offsetWidth > panel.scrollLeft + panel.clientWidth) {
        panel.scrollLeft = Math.max(0, left - 24);
      }
    }
    lastCurrentId = curId;
    panel.addEventListener('scroll', () => { lastScrollLeft = panel.scrollLeft; });
  }

  function render() {
    if (!view) return;
    ensureHost();
    const v = view;
    const st = statusText(v);
    const progress = v.visitedCount + '/' + v.total;
    const toastEl = toast && Date.now() < toast.until
      ? h('div', { class: 'toast' + (collapsed ? ' fixed' : ''), role: 'status' }, toast.text)
      : null;

    if (collapsed) {
      shadow.replaceChildren(toastEl || '', h('div', { class: 'pill' }, [
        h('button', { title: 'ナビを開く', onclick: () => setCollapsed(false) }, [
          '▲ ' + progress,
          autoTimer ? h('span', { class: 'auto-left' }, autoLeftText()) : null,
        ]),
        h('button', { class: 'primary', disabled: !v.canNext, onclick: () => act('next') }, '次へ ▶'),
      ]));
      return;
    }

    const cur = v.current;
    shadow.replaceChildren(h('div', { class: 'wrap' }, [
      toastEl,
      listOpen ? listPanel(v) : null,
      editMenuOpen
        ? h('div', { class: 'menu', role: 'menu' }, [
            h('div', { class: 'menu-title' }, 'どちらで編集しますか？'),
            h('button', { role: 'menuitem', onclick: () => openEditor('openOptions') }, [
              h('strong', null, '編集画面'),
              h('span', null, '新しいタブで、全画面の編集画面を開く'),
            ]),
            h('button', { role: 'menuitem', onclick: () => openEditor('openSidePanel') }, [
              h('strong', null, 'サイドパネル'),
              h('span', null, 'このページの横に開き、ブラウジングしながら登録する'),
            ]),
            menuError ? h('div', { class: 'menu-error' }, menuError) : null,
          ])
        : null,
      h('div', { class: 'bar' }, [
        h('button', { class: 'icon', title: 'ナビを折りたたむ', onclick: () => setCollapsed(true) }, '▼'),
        h('div', { class: 'info' }, [h('div', { class: 'title' }, st.title), h('div', { class: 'sub' }, st.sub)]),
        h('div', {
          class: 'prog',
          title: '今日のチェック数 / 全サイト数' + (v.noNewCount ? '\n新着動画がないため飛ばすチャンネル: ' + v.noNewCount + '件' : ''),
        }, progress + (v.noNewCount ? '（新着なし ' + v.noNewCount + '）' : '')),
        cur ? checkButton(cur.siteId, cur.visited, cur.noNew, cur.noNewVisited) : null,
        autoCheck(cur),
        h('button', { disabled: !v.canPrev, onclick: () => act('prev') }, '◀ 前へ'),
        h('button', { class: 'primary', disabled: !v.canNext, onclick: () => act('next') }, '次へ ▶'),
        h('button', { disabled: !v.canNextCategory, onclick: () => act('nextCategory') }, '次カテゴリ ⏭'),
        h('button', {
          class: listOpen ? 'active' : '',
          onclick: async () => { editMenuOpen = false; await setListOpen(!listOpen); render(); },
        }, '☰ 一覧'),
        h('button', {
          class: editMenuOpen ? 'active' : '',
          'aria-haspopup': 'menu',
          onclick: async () => { editMenuOpen = !editMenuOpen; menuError = null; if (listOpen) await setListOpen(false); render(); },
        }, '✎ 編集'),
      ]),
    ]));
    restoreListScroll(v);
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap, .pill {
      --bg: rgba(255,255,255,.97); --fg: #1d232b; --muted: #66707c; --border: #d6d9de;
      --btn: #f1f3f6; --primary: #2563eb; --ok: #16a34a; --hl: #e8efff; --quiet: #9aa1aa;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif;
      color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .wrap, .pill {
        --bg: rgba(24,27,32,.97); --fg: #e6e9ee; --muted: #9aa3ae; --border: #3a414b;
        --btn: #2a3038; --primary: #5b8cff; --ok: #34c46a; --hl: #24324d; --quiet: #8b939c;
      }
    }
    .bar {
      display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      background: var(--bg); border-top: 1px solid var(--border);
      box-shadow: 0 -2px 10px rgba(0,0,0,.12);
    }
    .info { flex: 1; min-width: 0; }
    .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .prog { font-variant-numeric: tabular-nums; color: var(--muted); padding: 0 4px; white-space: nowrap; }
    button {
      font: inherit; color: var(--fg); background: var(--btn); border: 1px solid var(--border);
      border-radius: 6px; padding: 5px 10px; cursor: pointer; white-space: nowrap;
    }
    button:hover:not(:disabled) { filter: brightness(.95); }
    button:disabled { opacity: .4; cursor: default; }
    button.primary { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
    button.active { outline: 2px solid var(--primary); }
    button.icon { padding: 5px 8px; }
    button.check {
      width: 28px; height: 28px; padding: 0; border-radius: 50%; font-weight: 700;
      border: 2px solid var(--border); background: transparent; color: #fff;
    }
    button.check.on { background: var(--ok); border-color: var(--ok); }
    /* 新着なし: グレーの塗りつぶし。未巡回は黒い ✓、巡回済みは白い ✓ */
    button.check.quiet { background: var(--quiet); border-color: var(--quiet); color: #111; }
    button.check.on.quiet { color: #fff; }
    .panel {
      display: flex; gap: 0; overflow-x: auto; overflow-y: hidden;
      background: var(--bg); border-top: 1px solid var(--border); padding: 6px 4px 8px;
      scrollbar-width: thin; scrollbar-color: var(--border) transparent;
    }
    .panel section {
      flex: none; padding: 0 12px; border-left: 1px solid var(--border);
    }
    .panel section:first-child { border-left: none; }
    .panel h4 { margin: 2px 0 4px; font-size: 13px; white-space: nowrap; }
    /* 縦4行で折り返して右の列へ */
    .sites {
      display: grid; grid-auto-flow: column; grid-template-rows: repeat(4, auto);
      grid-auto-columns: 200px; gap: 0 8px;
    }
    .muted { color: var(--muted); font-weight: 400; }
    .row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 6px; }
    .row.current { background: var(--hl); }
    .row button.check { width: 22px; height: 22px; font-size: 12px; flex: none; }
    .row.nonew button.link { color: var(--muted); }
    .badge {
      flex: none; font-size: 10px; line-height: 1; padding: 3px 5px; border-radius: 4px;
      color: var(--muted); border: 1px solid var(--border);
    }
    button.link {
      background: none; border: none; padding: 2px 0; text-align: left; flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis;
    }
    button.link:hover { text-decoration: underline; }
    .wrap { position: relative; }
    /* トースト: ナビの直上・左右中央 */
    .toast {
      position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%);
      max-width: min(560px, 90vw); padding: 10px 16px; border-radius: 999px;
      background: #1d232b; color: #fff; font: 600 13px/1.4 system-ui, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.25); text-align: center; pointer-events: none;
      animation: toast-in .2s ease-out;
    }
    .toast.fixed { position: fixed; bottom: 64px; }
    @media (prefers-color-scheme: dark) { .toast { background: #f1f3f6; color: #1d232b; } }
    @keyframes toast-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .menu {
      position: absolute; right: 10px; bottom: calc(100% + 6px); width: 300px;
      display: flex; flex-direction: column; gap: 6px; padding: 10px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,.2);
    }
    .menu-title { font-weight: 600; }
    .menu button {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      text-align: left; white-space: normal; padding: 8px 10px;
    }
    .menu button span { color: var(--muted); font-size: 12px; }
    .menu-error { color: #e5484d; font-size: 12px; }
    .auto {
      display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; white-space: nowrap;
      border: 1px solid var(--border); border-radius: 6px; cursor: pointer; user-select: none;
    }
    .auto.on { border-color: var(--primary); }
    .auto input { margin: 0; accent-color: var(--primary); cursor: pointer; }
    .auto-left { color: var(--muted); font-variant-numeric: tabular-nums; margin-left: 4px; }
    .pill {
      position: fixed; right: 12px; bottom: 12px; display: flex; gap: 4px; padding: 4px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,.18);
    }
  `;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.routineState || changes.routineData || changes.navCollapsed || changes.navToast || changes.feedStatus || changes.autoTour)) refresh();
  });

  refresh();
})();
