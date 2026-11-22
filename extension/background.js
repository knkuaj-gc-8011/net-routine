// ネットルーティン PC版 service worker
// 一覧（routineData）と当日の状態（routineState）は chrome.storage.local、
// 巡回タブのID（routineTabId）は chrome.storage.session に保存する。
importScripts('core.js');
const C = self.RoutineCore;

async function loadAll() {
  const r = await chrome.storage.local.get(['routineData', 'routineState']);
  const data = r.routineData || C.emptyData();
  const state = C.normalizeState(r.routineState, data, new Date());
  return { data, state };
}

async function getRoutineTabId() {
  const r = await chrome.storage.session.get('routineTabId');
  return r.routineTabId ?? null;
}

// 巡回タブを1つ使い回す。なければ（閉じられていたら）新しく作る
async function openInRoutineTab(url) {
  const tabId = await getRoutineTabId();
  if (tabId !== null) {
    try {
      const tab = await chrome.tabs.update(tabId, { url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch (e) {
      // タブがもう存在しない
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  await chrome.storage.session.set({ routineTabId: tab.id });
}

async function focusRoutineTab() {
  const tabId = await getRoutineTabId();
  if (tabId === null) return false;
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return true;
  } catch (e) {
    return false;
  }
}

async function buildView(senderTabId) {
  const { data, state } = await loadAll();
  const view = C.getView(data, state, new Date());
  const tabId = await getRoutineTabId();
  view.hasRoutineTab = tabId !== null;
  view.isRoutineTab = senderTabId !== undefined && senderTabId === tabId;
  return view;
}

async function handle(msg, sender) {
  const senderTabId = sender.tab ? sender.tab.id : undefined;
  switch (msg.cmd) {
    case 'view':
      return buildView(senderTabId);
    case 'action': {
      const { data, state } = await loadAll();
      const res = C.applyAction(data, state, msg.action, new Date());
      if (!res.noop) {
        const save = { routineState: res.state };
        // 最初に戻ったときの案内は、移動先のページのナビバーでトースト表示する
        if (res.notice) save.navToast = { text: res.notice, at: Date.now() };
        await chrome.storage.local.set(save);
      }
      if (res.entry) await openInRoutineTab(res.entry.site.url);
      return Object.assign(await buildView(senderTabId), { result: { finished: res.finished, noop: res.noop, notice: res.notice } });
    }
    case 'toggle': {
      const { data, state } = await loadAll();
      await chrome.storage.local.set({ routineState: C.toggleVisited(data, state, msg.siteId, new Date()) });
      return buildView(senderTabId);
    }
    case 'focusTab':
      return { ok: await focusRoutineTab() };
    case 'openTab': {
      // 巡回タブを表示する。閉じられていたら、最後に見ていたサイト（なければ最初のサイト）で開き直す
      if (await focusRoutineTab()) return buildView(senderTabId);
      const { data, state } = await loadAll();
      const list = C.flatten(data);
      if (list.length === 0) return buildView(senderTabId);
      const siteId = state.currentSiteId || list[0].site.id;
      const res = C.applyAction(data, state, { type: 'goto', siteId }, new Date());
      await chrome.storage.local.set({ routineState: res.state });
      await openInRoutineTab(res.entry.site.url);
      return buildView(senderTabId);
    }
    default:
      return { error: 'unknown command' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // サイドパネルはクリック直後でないと開けないため、await を挟まずにすぐ開く
  if (msg.cmd === 'openSidePanel') {
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    chrome.sidePanel.open({ windowId }).then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
    );
    return true;
  }
  if (msg.cmd === 'openOptions') {
    chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true; // 非同期で返す
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getRoutineTabId()) === tabId) await chrome.storage.session.remove('routineTabId');
});

// 初回インストール時は編集画面を開く
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
