// 編集画面（options.html とサイドパネル sidepanel.html で共用）
// 共通の RoutineEditor を chrome.storage.local につなぐ。
const isPanel = document.body.dataset.mode === 'panel';

// サイドパネルでは、同じウィンドウで表示中のタブを「今のページ」とする
async function getCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ? { title: tab.title, url: tab.url } : null;
}

// YouTube の新着確認の結果（各チャンネルの行に表示する）
let feedStatus = {};
let lastViewed = {};
const fmt = (t) => {
  const d = new Date(t);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
function feedInfo(siteId) {
  const st = feedStatus[siteId];
  if (!st) return '確認待ち';
  if (st.error) return '確認できませんでした（' + st.error + '）→ 飛ばしません';
  if (typeof st.latest !== 'number') return '動画がありません';
  const viewed = lastViewed[siteId];
  const head = '最新動画 ' + fmt(st.latest);
  if (typeof viewed !== 'number') return head + '・まだアプリから開いていません';
  return head + '・前回 ' + fmt(viewed) + (st.latest > viewed ? ' → 新着あり' : ' → 新着なし（飛ばす）');
}

const editor = RoutineEditor.mount(document.getElementById('editor'), {
  load: async () => {
    const r = await chrome.storage.local.get(['routineData', 'feedStatus', 'siteLastViewed']);
    feedStatus = r.feedStatus || {};
    lastViewed = r.siteLastViewed || {};
    return r.routineData || RoutineCore.emptyData();
  },
  save: (data) => chrome.storage.local.set({ routineData: data }),
  getCurrentPage: isPanel ? getCurrentPage : undefined,
  feedToggle: true,
  feedInfo,
});

// 別の画面で変更されたときも表示を合わせる（入力中は邪魔しない）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.routineData || changes.feedStatus || changes.siteLastViewed)) return;
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
  editor.reload();
});

if (isPanel) {
  // 表示中のページを上部に表示し、タブの切り替えやページ移動に追従する
  const showCurrent = async () => {
    const page = await getCurrentPage().catch(() => null);
    document.getElementById('curTitle').textContent = (page && page.title) || '—';
    document.getElementById('curUrl').textContent = (page && page.url) || '';
  };
  chrome.tabs.onActivated.addListener(showCurrent);
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (tab.active && (info.url || info.title || info.status === 'complete')) showCurrent();
  });
  chrome.windows.onFocusChanged.addListener(showCurrent);
  showCurrent();
} else {
  // 全画面の編集画面からも、サイドパネルを開けるようにする
  const btn = document.getElementById('openPanel');
  if (btn) {
    // クリック直後でないと開けないため、ウィンドウIDを先に取っておく
    let windowId = null;
    chrome.windows.getCurrent().then((w) => { windowId = w.id; });
    btn.addEventListener('click', () => chrome.sidePanel.open({ windowId }));
  }
}
