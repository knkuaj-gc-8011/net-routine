// ネットルーティン iPhone版 用の中継サーバー（Cloudflare Workers）
// iPhone のWebアプリは YouTube のデータを直接読めない（CORS の制限）ため、ここで代わりに読む。
//
// 使い方: GET <このWorkerのURL>?url=<YouTubeチャンネルのURL>[&channelId=UC...]
// 応答:   { "channelId": "UC...", "latest": 最新動画の公開日時（ミリ秒）| null }
//         失敗時は { "error": "理由" }
//
// ・YouTube のチャンネル以外は扱わない（何でも取りに行ける中継にはしない）
// ・応答するのは下の ALLOWED_ORIGINS のページからの問い合わせだけ

const ALLOWED_ORIGINS = ['https://knkuaj-gc-8011.github.io'];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    const reply = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers });
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'GET') return reply({ error: 'GET のみ対応しています' }, 405);
    // ブラウザからの問い合わせは、許可したページからだけ受け付ける
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: '許可されていない問い合わせ元です' }, 403);

    const params = new URL(request.url).searchParams;
    let channelId = params.get('channelId');
    try {
      if (!channelId || !/^UC[\w-]{22}$/.test(channelId)) {
        const pageUrl = channelPageUrl(params.get('url'));
        if (!pageUrl) return reply({ error: 'YouTube のチャンネルURLではありません' }, 400);
        channelId = pageUrl.channelId || extractChannelId(await fetchText(pageUrl.url));
        if (!channelId) return reply({ error: 'チャンネルIDが見つかりません' }, 404);
      }
      const xml = await fetchText('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
      return reply({ channelId, latest: latestPublished(xml) });
    } catch (e) {
      return reply({ error: String(e && e.message ? e.message : e) }, 502);
    }
  },
};

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'Accept-Language': 'ja,en;q=0.8',
      'Cookie': 'SOCS=CAI', // 同意画面（cookie の確認ページ）を出さないため
      'User-Agent': 'Mozilla/5.0 (compatible; net-routine/1.0)',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// 以下は shared/core.js の youTubeChannelRef / extractChannelId / parseYouTubeFeedLatest と同じ判定
function channelPageUrl(input) {
  let u;
  try { u = new URL(String(input || '')); } catch (e) { return null; }
  if (!/^(www\.|m\.)?youtube\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1] || '')) return { channelId: parts[1] };
  if (/^@[^/]+$/.test(parts[0] || '')) return { url: 'https://www.youtube.com/' + parts[0] };
  if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return { url: 'https://www.youtube.com/' + parts[0] + '/' + parts[1] };
  return null;
}

function extractChannelId(html) {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /<meta itemprop="identifier" content="(UC[\w-]{22})"/,
    /"browseId":"(UC[\w-]{22})"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function latestPublished(xml) {
  const re = /<entry>[\s\S]*?<published>([^<]+)<\/published>/g;
  let latest = null;
  let m;
  while ((m = re.exec(xml))) {
    const t = Date.parse(m[1]);
    if (!isNaN(t) && (latest === null || t > latest)) latest = t;
  }
  return latest;
}
