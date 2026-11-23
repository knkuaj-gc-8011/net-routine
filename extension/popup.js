// ツールバーのポップアップ: 進捗の表示、巡回の開始・再開、一覧から直接開く
const $ = (id) => document.getElementById(id);
let mainAction = 'start'; // メインボタンで送る命令（start か openTab）

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 一覧: サイト名を押すと、そのサイトを巡回タブで開く
function renderList(v) {
  const list = $('list');
  list.hidden = v.total === 0;
  list.replaceChildren(
    ...v.categories.flatMap((cat) => {
      const h2 = el('h2');
      h2.append(el('span', '', cat.name), el('span', '', cat.visited + '/' + cat.total));
      return [
        h2,
        ...cat.sites.map((s) => {
          const row = el('div', 'row' + (s.current ? ' current' : ''));
          const btn = el('button', '', s.name);
          btn.title = s.url;
          btn.addEventListener('click', async () => {
            await chrome.runtime.sendMessage({ cmd: 'action', action: { type: 'goto', siteId: s.id } });
            window.close();
          });
          row.append(el('span', 'dot' + (s.visited ? ' on' : ''), s.visited ? '✓' : ''), btn);
          if (s.noNew) {
            row.classList.add('nonew');
            row.append(el('span', 'badge', '新着なし'));
          }
          return row;
        }),
      ];
    })
  );
}

function render(v) {
  const pct = v.total ? Math.round((v.visitedCount / v.total) * 100) : 0;
  $('meter').style.width = pct + '%';
  renderList(v);
  if (v.total === 0) {
    $('status').textContent = 'サイトが登録されていません';
    $('sub').textContent = '下の「編集」から登録してください';
    $('start').hidden = true;
    $('focus').hidden = true;
    return;
  }
  $('status').textContent = '今日のチェック: ' + v.visitedCount + ' / ' + v.total;
  if (v.remaining === 0) {
    // 完了後: 巡回タブを開き直せるようにする（開いていれば表示するだけ）
    $('sub').textContent = '🎉 今日の巡回は完了しています。見直すときは下の一覧からも開けます';
    $('start').textContent = v.hasRoutineTab ? '巡回タブを表示' : '巡回タブを開く';
    mainAction = 'openTab';
    $('focus').hidden = true;
    return;
  }
  mainAction = 'start';
  $('focus').hidden = !v.hasRoutineTab;
  if (v.visitedCount > 0) {
    $('sub').textContent = '未訪問 ' + v.remaining + '件';
    $('start').textContent = '続きから巡回';
  } else {
    $('sub').textContent = '毎日 午前5時にチェックがリセットされます';
    $('start').textContent = '巡回を開始';
  }
}

chrome.runtime.sendMessage({ cmd: 'view' }).then(render);

$('start').addEventListener('click', async () => {
  // 巡回開始は YouTube の新着確認を待つことがあるので、その間の表示を出す
  if (mainAction === 'start') {
    $('start').disabled = true;
    $('start').textContent = 'YouTube の新着を確認中…';
  }
  const msg = mainAction === 'openTab' ? { cmd: 'openTab' } : { cmd: 'action', action: { type: 'start' } };
  await chrome.runtime.sendMessage(msg);
  window.close();
});
$('focus').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ cmd: 'focusTab' });
  window.close();
});

// サイドパネルはクリック直後（ユーザー操作の中）でしか開けないため、ウィンドウIDを先に取っておく
let windowId = null;
chrome.windows.getCurrent().then((w) => { windowId = w.id; });
$('panel').addEventListener('click', () => {
  chrome.sidePanel.open({ windowId }).then(() => window.close());
});
$('edit').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
