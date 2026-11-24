// ネットルーティン PC版 service worker
// chrome.storage.local:
//   routineData … 一覧 / routineState … 当日の状態（毎朝5時リセット）
//   siteLastViewed … { siteId: アプリから最後に開いた日時 }（リセットしない）
//   feedStatus … { siteId: { url, channelId, latest, checkedAt, error } }（YouTube の新着確認結果）
// chrome.storage.session: routineTabId … 巡回タブのID
importScripts('core.js');
const C = self.RoutineCore;

async function loadAll() {
  const r = await chrome.storage.local.get(['routineData', 'routineState', 'feedStatus', 'siteLastViewed']);
  const data = r.routineData || C.emptyData();
  const state = C.normalizeState(r.routineState, data, new Date());
  // 新着のない YouTube チャンネルは「次へ」などで飛ばす
  const skip = C.computeFeedSkip(data, r.feedStatus, r.siteLastViewed);
  return { data, state, skip };
}

// アプリから開いた日時を記録する（YouTube の新着判定の基準）
async function recordViewed(siteId) {
  const r = await chrome.storage.local.get('siteLastViewed');
  const lv = r.siteLastViewed || {};
  lv[siteId] = Date.now();
  await chrome.storage.local.set({ siteLastViewed: lv });
}

/* ---------- YouTube チャンネルの新着確認 ---------- */

const FEED_MIN_INTERVAL = 5 * 60 * 1000; // 同じチャンネルを5分以内に何度も確認しない
let feedCheckRunning = null;

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// 1チャンネル分を確認して、新しい状態を返す
async function checkOneFeed(site, prev) {
  const st = prev && prev.url === site.url ? Object.assign({}, prev) : { url: site.url };
  try {
    if (!st.channelId) {
      const ref = C.youTubeChannelRef(site.url);
      st.channelId = ref.channelId || C.extractChannelId(await fetchText(ref.pageUrl));
      if (!st.channelId) throw new Error('チャンネルIDが見つかりません');
    }
    const xml = await fetchText('https://www.youtube.com/feeds/videos.xml?channel_id=' + st.channelId);
    st.latest = C.parseYouTubeFeedLatest(xml);
    st.error = null;
  } catch (e) {
    // 確認できなかったときは「新着あり」扱い（飛ばさない）
    st.latest = null;
    st.error = String(e && e.message ? e.message : e);
  }
  st.checkedAt = Date.now();
  return st;
}

// 全チャンネルを確認する（同時に1回だけ実行）
function checkFeeds() {
  if (feedCheckRunning) return feedCheckRunning;
  feedCheckRunning = (async () => {
    const r = await chrome.storage.local.get(['routineData', 'feedStatus']);
    const data = r.routineData || C.emptyData();
    const old = r.feedStatus || {};
    const next = {};
    const targets = C.flatten(data)
      .map((e) => e.site)
      .filter((s) => !s.noFeedCheck && C.isYouTubeChannelUrl(s.url));
    // 4件ずつ並行して確認する
    const queue = targets.slice();
    const worker = async () => {
      while (queue.length) {
        const site = queue.shift();
        const prev = old[site.id];
        const fresh = prev && prev.url === site.url && !prev.error && Date.now() - prev.checkedAt < FEED_MIN_INTERVAL;
        next[site.id] = fresh ? prev : await checkOneFeed(site, prev);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await chrome.storage.local.set({ feedStatus: next });
    return next;
  })().finally(() => { feedCheckRunning = null; });
  return feedCheckRunning;
}

// 最大 ms ミリ秒だけ待つ（巡回開始を長く待たせないため）
function waitAtMost(promise, ms) {
  return Promise.race([promise.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

// 30分ごとに確認する
function ensureFeedAlarm() {
  chrome.alarms.get('feedCheck', (a) => {
    if (!a) chrome.alarms.create('feedCheck', { periodInMinutes: 30, delayInMinutes: 1 });
  });
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'feedCheck') checkFeeds();
});
chrome.runtime.onStartup.addListener(() => { ensureFeedAlarm(); checkFeeds(); });
ensureFeedAlarm();

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
  const { data, state, skip } = await loadAll();
  const view = C.getView(data, state, new Date(), { skip });
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
      // 巡回開始のときは、新着を確認してから始める（最大6秒待つ）
      if (msg.action && msg.action.type === 'start') await waitAtMost(checkFeeds(), 6000);
      const { data, state, skip } = await loadAll();
      const res = C.applyAction(data, state, msg.action, new Date(), { skip });
      if (res.entry) await recordViewed(res.entry.site.id);
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
      const { data, state, skip } = await loadAll();
      await chrome.storage.local.set({ routineState: C.toggleVisited(data, state, msg.siteId, new Date(), { skip }) });
      return buildView(senderTabId);
    }
    case 'focusTab':
      return { ok: await focusRoutineTab() };
    case 'checkFeeds':
      await checkFeeds();
      return buildView(senderTabId);
    case 'openTab': {
      // 巡回タブを表示する。閉じられていたら、最後に見ていたサイト（なければ最初のサイト）で開き直す
      if (await focusRoutineTab()) return buildView(senderTabId);
      const { data, state } = await loadAll();
      const list = C.flatten(data);
      if (list.length === 0) return buildView(senderTabId);
      const siteId = state.currentSiteId || list[0].site.id;
      const res = C.applyAction(data, state, { type: 'goto', siteId }, new Date());
      await chrome.storage.local.set({ routineState: res.state });
      await recordViewed(res.entry.site.id);
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
  ensureFeedAlarm();
  checkFeeds();
});

// 一覧が編集されたら（チャンネルの追加・URL変更など）確認し直す
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.routineData) checkFeeds();
});
