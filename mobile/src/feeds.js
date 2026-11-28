// YouTube チャンネルの新着確認。アプリからは直接 YouTube に問い合わせられる（中継サーバー不要）
import C from './core';

export const FEED_MIN_INTERVAL = 5 * 60 * 1000; // 同じチャンネルを5分以内に何度も確認しない

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'ja,en;q=0.8', Cookie: 'SOCS=CAI' }, // 同意画面を出さないため
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// 1チャンネル分を確認して、新しい状態を返す
async function checkOne(site, prev) {
  const st = prev && prev.url === site.url ? { ...prev } : { url: site.url };
  try {
    if (!st.channelId) {
      const ref = C.youTubeChannelRef(site.url);
      st.channelId = ref.channelId || C.extractChannelId(await fetchText(ref.pageUrl));
      if (!st.channelId) throw new Error('チャンネルIDが見つかりません');
    }
    const feed = C.parseYouTubeFeed(await fetchText('https://www.youtube.com/feeds/videos.xml?channel_id=' + st.channelId));
    st.latest = feed.latest;
    st.videos = feed.videos;
    st.error = null;
  } catch (e) {
    // 確認できなかったときは「新着あり」扱い（飛ばさない）
    st.latest = null;
    st.videos = [];
    st.error = String(e && e.message ? e.message : e);
  }
  st.checkedAt = Date.now();
  return st;
}

/** 全チャンネルを確認して、新しい feedStatus を返す。force なら5分以内でも確認し直す */
export async function checkFeeds(data, old, force) {
  const prevAll = old || {};
  const next = {};
  const queue = C.flatten(data)
    .map((e) => e.site)
    .filter((s) => !s.noFeedCheck && C.isYouTubeChannelUrl(s.url));
  const worker = async () => {
    while (queue.length) {
      const site = queue.shift();
      const prev = prevAll[site.id];
      const fresh = !force && prev && prev.url === site.url && !prev.error && Array.isArray(prev.videos)
        && Date.now() - prev.checkedAt < FEED_MIN_INTERVAL;
      next[site.id] = fresh ? prev : await checkOne(site, prev);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return next;
}
