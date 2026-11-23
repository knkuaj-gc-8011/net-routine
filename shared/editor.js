/*
 * ネットルーティン 編集画面（PC版の options・iPhone版の編集画面で共用）
 * 正本は shared/editor.js。scripts/sync-core.ps1 でコピーする。
 * 使い方: RoutineEditor.mount(要素, { load: async () => data, save: async (data) => {}, getCurrentPage? })
 *   getCurrentPage（省略可）: async () => ({ title, url })。
 *   渡すと、各行に「登録」（表示中ページのURLを入れる）と「今のページを追加」ボタンが出る。
 *   grabLabels（省略可）: { row, rowTitle, add, addTitle, error } でボタンの文言とエラー文を変えられる。
 *   feedToggle（省略可）: true なら YouTube チャンネルの行に「新着チェック」の切り替えを出す（PC版）。
 *   feedInfo（省略可）: (siteId) => 文字列。新着チェックの状況として行に表示する。
 */
(function (root) {
  'use strict';
  const C = root.RoutineCore;

  // 要素を作る小さなヘルパー。文字列は必ず textContent で入れる
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(function ([k, v]) {
      if (v === undefined || v === null || v === false) return;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function mount(container, opts) {
    let data = C.emptyData();
    let message = null; // { text, error }
    // 「登録」系ボタンの文言（PC版の既定値。iPhone版はコピー経由用に差し替える）
    const labels = Object.assign({
      row: '登録',
      rowTitle: '表示中のページの URL をこの行に入れる',
      add: '今のページを追加',
      addTitle: '表示中のページをこのカテゴリに追加する',
      error: '表示中のページは登録できません（http/https のページを開いてください）',
    }, opts.grabLabels || {});
    const drafts = {}; // 追加フォームの書きかけ（再描画しても残す）

    async function commit(next) {
      data = next;
      await opts.save(data);
      render();
    }

    function show(text, error) {
      message = { text: text, error: !!error };
      render();
    }

    function downloadJson() {
      const blob = new Blob([C.exportJson(data)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'net-routine.json' });
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    async function copyJson() {
      try {
        await navigator.clipboard.writeText(C.exportJson(data));
        show('JSON をクリップボードにコピーしました');
      } catch (e) {
        show('コピーできませんでした: ' + e.message, true);
      }
    }

    async function importText(text) {
      const r = C.validateImport(text);
      if (!r.ok) return show('読み込めません: ' + r.error, true);
      const n = C.flatten(r.data).length;
      if (!confirm('今の一覧を置き換えて、' + r.data.categories.length + 'カテゴリ・' + n + 'サイトを読み込みます。よろしいですか？')) return;
      await commit(r.data);
      show('読み込みました（' + n + 'サイト）');
    }

    // 表示中のページを取得する。登録できないページならメッセージを出して null を返す
    async function currentPage() {
      let page = null;
      try {
        page = await opts.getCurrentPage();
      } catch (e) {
        // 取得できない
      }
      const href = page && C.normalizeUrl(page.url);
      if (!href || !/^https?:/i.test(String(page.url))) {
        show(labels.error, true);
        return null;
      }
      return { title: String(page.title || '').trim(), url: href };
    }

    async function setUrlFromPage(site) {
      const page = await currentPage();
      if (!page) return;
      const r = C.updateSite(data, site.id, { url: page.url });
      if (!r.ok) return show(r.error, true);
      message = { text: '「' + site.name + '」の URL を登録しました: ' + page.url, error: false };
      commit(r.data);
    }

    async function addFromPage(cat) {
      const page = await currentPage();
      if (!page) return;
      const r = C.addSite(data, cat.id, page.title, page.url);
      if (!r.ok) return show(r.error, true);
      message = { text: '「' + cat.name + '」に追加しました: ' + (page.title || page.url), error: false };
      commit(r.data);
    }

    // YouTube チャンネルの行に出す「新着チェック」の切り替え
    function feedRow(site) {
      if (!opts.feedToggle || !C.isYouTubeChannelUrl(site.url)) return null;
      const on = !site.noFeedCheck;
      const info = on && opts.feedInfo ? opts.feedInfo(site.id) : '';
      return h('div', { class: 're-feed' }, [
        h('label', null, [
          h('input', {
            type: 'checkbox', checked: on, 'data-key': 'feed:' + site.id,
            onchange: function (e) { commit(C.updateSite(data, site.id, { noFeedCheck: !e.target.checked }).data); },
          }),
          ' 新着チェック（新しい動画がなければ「次へ」で飛ばす）',
        ]),
        info ? h('span', { class: 're-feed-info' }, info) : null,
      ]);
    }

    function siteRow(site) {
      return h('div', { class: 're-site' }, [
        h('input', {
          class: 're-site-name', value: site.name, 'aria-label': 'サイト名', 'data-key': 'sname:' + site.id,
          onchange: function (e) { commit(C.updateSite(data, site.id, { name: e.target.value }).data); },
        }),
        h('input', {
          class: 're-site-url', value: site.url, type: 'url', 'aria-label': 'URL', 'data-key': 'surl:' + site.id,
          onchange: function (e) {
            const r = C.updateSite(data, site.id, { url: e.target.value });
            if (!r.ok) return show(r.error, true);
            commit(r.data);
          },
        }),
        h('div', { class: 're-btns' }, [
          opts.getCurrentPage
            ? h('button', { class: 're-grab', title: labels.rowTitle, onclick: function () { setUrlFromPage(site); } }, labels.row)
            : null,
          h('button', { title: '上へ', onclick: function () { commit(C.moveSite(data, site.id, -1)); } }, '▲'),
          h('button', { title: '下へ', onclick: function () { commit(C.moveSite(data, site.id, 1)); } }, '▼'),
          h('button', {
            class: 're-danger', title: '削除',
            onclick: function () { if (confirm('「' + site.name + '」を削除しますか？')) commit(C.removeSite(data, site.id)); },
          }, '✕'),
        ]),
        feedRow(site),
      ]);
    }

    function addSiteForm(cat) {
      const nk = 'addname:' + cat.id;
      const uk = 'addurl:' + cat.id;
      const keep = function (e) { drafts[e.target.getAttribute('data-key')] = e.target.value; };
      const name = h('input', { placeholder: 'サイト名（省略可）', 'aria-label': '追加するサイト名', 'data-key': nk, value: drafts[nk] || '', oninput: keep });
      const url = h('input', { placeholder: 'URL', type: 'url', 'aria-label': '追加するURL', 'data-key': uk, value: drafts[uk] || '', oninput: keep });
      function add() {
        const r = C.addSite(data, cat.id, name.value, url.value);
        if (!r.ok) return show(r.error, true);
        message = null;
        delete drafts[nk];
        delete drafts[uk];
        commit(r.data);
      }
      url.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
      return h('div', { class: 're-site re-add' }, [
        name,
        url,
        h('div', { class: 're-btns' }, [
          h('button', { class: 're-primary', onclick: add }, '追加'),
          opts.getCurrentPage
            ? h('button', { class: 're-grab', title: labels.addTitle, onclick: function () { addFromPage(cat); } }, labels.add)
            : null,
        ]),
      ]);
    }

    function categoryCard(cat) {
      return h('section', { class: 're-cat' }, [
        h('div', { class: 're-cat-head' }, [
          h('input', {
            class: 're-cat-name', value: cat.name, 'aria-label': 'カテゴリ名', 'data-key': 'cat:' + cat.id,
            onchange: function (e) { commit(C.renameCategory(data, cat.id, e.target.value)); },
          }),
          h('div', { class: 're-btns' }, [
            h('button', { title: '上へ', onclick: function () { commit(C.moveCategory(data, cat.id, -1)); } }, '▲'),
            h('button', { title: '下へ', onclick: function () { commit(C.moveCategory(data, cat.id, 1)); } }, '▼'),
            h('button', {
              class: 're-danger', title: '削除',
              onclick: function () {
                if (confirm('カテゴリ「' + cat.name + '」と中のサイト' + cat.sites.length + '件を削除しますか？')) commit(C.removeCategory(data, cat.id));
              },
            }, '✕'),
          ]),
        ]),
        h('div', { class: 're-sites' }, cat.sites.map(siteRow)),
        addSiteForm(cat),
      ]);
    }

    function render() {
      // 再描画しても、入力中の欄のフォーカスを保つ
      const active = document.activeElement;
      const focusKey = active && container.contains(active) ? active.getAttribute('data-key') : null;
      renderBody();
      if (focusKey) {
        const el = container.querySelector('[data-key="' + focusKey + '"]');
        if (el) el.focus();
      }
    }

    function renderBody() {
      const fileInput = h('input', {
        type: 'file', accept: '.json,application/json',
        onchange: async function (e) {
          const f = e.target.files[0];
          if (f) await importText(await f.text());
        },
      });
      const pasteArea = h('textarea', { rows: 4, placeholder: 'ここに JSON を貼り付け' });

      container.replaceChildren(
        h('div', { class: 'routine-editor' }, [
          message ? h('p', { class: 're-msg' + (message.error ? ' re-msg-error' : '') }, message.text) : null,
          data.categories.length === 0 ? h('p', { class: 're-empty' }, 'まだカテゴリがありません。下のボタンから追加するか、JSON を読み込んでください。') : null,
          ...data.categories.map(categoryCard),
          h('button', { class: 're-primary re-add-cat', onclick: function () { commit(C.addCategory(data, '新しいカテゴリ')); } }, '＋ カテゴリを追加'),
          h('section', { class: 're-io' }, [
            h('h3', null, 'JSON の書き出し・読み込み'),
            h('p', { class: 're-hint' }, 'PC版とiPhone版で一覧を移すときに使います。読み込むと今の一覧は置き換わります。'),
            h('div', { class: 're-row' }, [
              h('button', { onclick: downloadJson }, 'ファイルに書き出す'),
              h('button', { onclick: copyJson }, 'コピー'),
            ]),
            h('div', { class: 're-row' }, [h('label', null, ['ファイルから読み込む: ', fileInput])]),
            pasteArea,
            h('div', { class: 're-row' }, [h('button', { onclick: function () { importText(pasteArea.value); } }, '貼り付けた JSON を読み込む')]),
          ]),
        ])
      );
    }

    Promise.resolve(opts.load()).then(function (d) {
      data = d || C.emptyData();
      render();
    });

    return {
      reload: async function () {
        data = (await opts.load()) || C.emptyData();
        render();
      },
    };
  }

  root.RoutineEditor = { mount: mount };
})(globalThis);
