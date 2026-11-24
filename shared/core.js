/*
 * ネットルーティン 共通ロジック（PC版・iPhone版で共用）
 * 正本は shared/core.js。extension/ と iphone/ へは scripts/sync-core.ps1 でコピーする。
 * DOM やブラウザ API に依存しない純粋な関数だけを置く。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoutineCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 訪問チェックがリセットされる時刻（時）
  const RESET_HOUR = 5;
  const DATA_VERSION = 1;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** 午前5時区切りの「その日」を表すキー（YYYY-MM-DD, ローカル時刻） */
  function getDayKey(now) {
    const d = new Date((now || new Date()).getTime());
    d.setHours(d.getHours() - RESET_HOUR);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function genId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function emptyData() {
    return { version: DATA_VERSION, categories: [] };
  }

  function emptyState(now) {
    // noNewVisited … 「新着なし」の状態で開いた（チェックした）サイトID。表示の色分けに使う
    return { dayKey: getDayKey(now), visited: [], noNewVisited: [], currentSiteId: null, finished: false };
  }

  /** カテゴリ→サイトの2階層を、巡回順の1次元リストにする */
  function flatten(data) {
    const list = [];
    ((data && data.categories) || []).forEach(function (category, catIndex) {
      (category.sites || []).forEach(function (site, siteIndex) {
        list.push({ site: site, category: category, catIndex: catIndex, siteIndex: siteIndex, index: list.length });
      });
    });
    return list;
  }

  function indexOfSite(list, siteId) {
    for (let i = 0; i < list.length; i++) if (list[i].site.id === siteId) return i;
    return -1;
  }

  /** 日付が変わっていたらチェックを空にし、存在しないサイトへの参照を取り除く */
  function normalizeState(state, data, now) {
    const key = getDayKey(now);
    let s = Object.assign(emptyState(now), state ? clone(state) : {});
    if (s.dayKey !== key) s = emptyState(now);
    const ids = new Set(flatten(data).map(function (e) { return e.site.id; }));
    s.visited = Array.from(new Set((s.visited || []).filter(function (id) { return ids.has(id); })));
    const visitedNow = new Set(s.visited);
    s.noNewVisited = Array.from(new Set((s.noNewVisited || []).filter(function (id) { return visitedNow.has(id); })));
    if (s.currentSiteId && !ids.has(s.currentSiteId)) s.currentSiteId = null;
    s.finished = !!s.finished;
    return s;
  }

  /**
   * 巡回操作を適用する。
   * action.type: 'start' | 'next' | 'prev' | 'nextCategory' | 'goto'（goto は action.siteId）
   * 戻り値: { state, entry, finished, noop, notice }
   *   entry … 開くべきサイト（flatten の要素）。null なら開くものなし
   *   finished … 未訪問サイトが残っていない（start のとき）
   *   noop … 何も変わらない（例: 先頭で「前へ」）
   *   notice … 最後から最初へ戻ったときの案内文（トースト用）。それ以外は null
   * opts.skip（省略可）: 「次へ」などで飛ばすサイトIDの配列（YouTube の新着なしチャンネルなど）。
   *   飛ばすサイトは、巡回完了の判定では「済み」と同じに扱う。一覧から選べば開ける
   */
  function applyAction(data, state, action, now, opts) {
    const s = normalizeState(state, data, now);
    const list = flatten(data);
    const visited = new Set(s.visited);
    const skip = new Set((opts && opts.skip) || []);
    const cur = s.currentSiteId ? indexOfSite(list, s.currentSiteId) : -1;
    const isDone = function (e) { return visited.has(e.site.id) || skip.has(e.site.id); };

    // 未巡回（チェックなし・飛ばし対象でもない）の最初のサイト
    function firstUnvisited(from, pred) {
      for (let i = Math.max(0, from); i < list.length; i++) {
        if (!isDone(list[i]) && (!pred || pred(list[i]))) return i;
      }
      return -1;
    }

    // 全サイトが済み（今日の巡回完了）なら、「次へ」「次カテゴリ」は一覧の順で進むだけにする
    const allVisited = list.length > 0 && list.every(isDone);

    let target = -1;
    let notice = null; // 最初に戻ったときにトーストで出す文言
    switch (action && action.type) {
      case 'start':
        target = firstUnvisited(0);
        break;
      case 'next':
        if (allVisited) {
          // 完了済み: 一覧の順で1つ次。最後のサイトなら最初のサイトへ
          if (cur + 1 < list.length) {
            target = cur + 1;
          } else {
            target = 0;
            notice = '最後のサイトだったので、最初のサイトに移動しました';
          }
          break;
        }
        target = cur < 0 ? firstUnvisited(0) : firstUnvisited(cur + 1);
        if (target < 0) {
          // 後ろに未巡回がなければ、未巡回の最初のサイトへ
          target = firstUnvisited(0);
          notice = '最後まで来たので、未巡回の最初のサイトに移動しました';
        }
        break;
      case 'prev':
        if (cur <= 0) return { state: s, entry: null, finished: false, noop: true };
        target = cur - 1;
        break;
      case 'nextCategory': {
        const ci = cur < 0 ? -1 : list[cur].catIndex;
        if (allVisited) {
          // 完了済み: 次カテゴリの先頭。最後のカテゴリなら最初のカテゴリの先頭へ
          target = list.findIndex(function (e) { return e.catIndex > ci; });
          if (target < 0) {
            target = 0;
            notice = '最後のカテゴリだったので、最初のカテゴリに移動しました';
          }
          break;
        }
        target = firstUnvisited(0, function (e) { return e.catIndex > ci; });
        if (target < 0) {
          // 後ろのカテゴリに未巡回がなければ、未巡回の最初のサイトへ
          target = firstUnvisited(0);
          notice = '後ろに未巡回のカテゴリがないので、未巡回の最初のサイトに移動しました';
        }
        break;
      }
      case 'goto':
        target = indexOfSite(list, action.siteId);
        if (target < 0) return { state: s, entry: null, finished: false, noop: true };
        break;
      default:
        return { state: s, entry: null, finished: false, noop: true };
    }

    if (target < 0) {
      s.currentSiteId = null;
      s.finished = true;
      return { state: s, entry: null, finished: true, noop: false };
    }

    const entry = list[target];
    s.currentSiteId = entry.site.id;
    s.finished = false;
    if (!visited.has(entry.site.id)) {
      s.visited.push(entry.site.id);
      // 新着なしの状態で開いたことを覚えておく（開いた後は前回閲覧が更新されて判定が変わるため）
      if (skip.has(entry.site.id)) s.noNewVisited.push(entry.site.id);
    }
    return { state: s, entry: entry, finished: false, noop: false, notice: notice };
  }

  /** 手動でチェックを付け外しする。opts.skip は applyAction と同じ */
  function toggleVisited(data, state, siteId, now, opts) {
    const s = normalizeState(state, data, now);
    const skip = new Set((opts && opts.skip) || []);
    const i = s.visited.indexOf(siteId);
    if (i >= 0) {
      s.visited.splice(i, 1);
      s.noNewVisited = s.noNewVisited.filter(function (id) { return id !== siteId; });
    } else if (indexOfSite(flatten(data), siteId) >= 0) {
      s.visited.push(siteId);
      if (skip.has(siteId)) s.noNewVisited.push(siteId);
    }
    return s;
  }

  function progress(data, state) {
    const visited = new Set((state && state.visited) || []);
    const categories = ((data && data.categories) || []).map(function (c) {
      const sites = c.sites || [];
      return {
        id: c.id,
        name: c.name,
        total: sites.length,
        visited: sites.filter(function (x) { return visited.has(x.id); }).length,
      };
    });
    const total = categories.reduce(function (a, c) { return a + c.total; }, 0);
    const done = categories.reduce(function (a, c) { return a + c.visited; }, 0);
    return { total: total, visited: done, remaining: total - done, categories: categories };
  }

  /** 画面表示用にまとめた情報。opts.skip は applyAction と同じ */
  function getView(data, state, now, opts) {
    const s = normalizeState(state, data, now);
    const list = flatten(data);
    const visited = new Set(s.visited);
    const skip = new Set((opts && opts.skip) || []);
    const noNewVisited = new Set(s.noNewVisited);
    const cur = s.currentSiteId ? indexOfSite(list, s.currentSiteId) : -1;
    const p = progress(data, s);
    const current = cur >= 0 ? list[cur] : null;
    // 残り = チェックなし かつ 飛ばし対象でもない
    const remaining = list.filter(function (e) { return !visited.has(e.site.id) && !skip.has(e.site.id); }).length;
    const noNewCount = list.filter(function (e) { return !visited.has(e.site.id) && skip.has(e.site.id); }).length;
    return {
      // 最後まで来たら最初に戻るので、サイトがあれば常に押せる
      canNext: p.total > 0,
      canNextCategory: p.total > 0,
      state: s,
      total: p.total,
      visitedCount: p.visited,
      remaining: remaining,
      noNewCount: noNewCount, // 新着なしで飛ばすサイトの数（チェックなしのもの）
      started: cur >= 0 || s.finished || p.visited > 0,
      finished: s.finished || (p.total > 0 && remaining === 0),
      current: current
        ? {
            siteId: current.site.id,
            siteName: current.site.name,
            url: current.site.url,
            categoryName: current.category.name,
            catProgress: p.categories[current.catIndex],
            position: cur + 1,
            visited: visited.has(current.site.id),
            noNew: skip.has(current.site.id) && !visited.has(current.site.id),
            noNewVisited: noNewVisited.has(current.site.id),
          }
        : null,
      canPrev: cur > 0,
      categories: ((data && data.categories) || []).map(function (c, ci) {
        return {
          id: c.id,
          name: c.name,
          total: p.categories[ci].total,
          visited: p.categories[ci].visited,
          sites: (c.sites || []).map(function (x) {
            return {
              id: x.id, name: x.name, url: x.url, visited: visited.has(x.id),
              // 「新着なし」はまだチェックしていないサイトにだけ出す（今日見たものに出しても紛らわしいため）
              current: x.id === s.currentSiteId, noNew: skip.has(x.id) && !visited.has(x.id),
              noNewVisited: noNewVisited.has(x.id), // 新着なしの状態で巡回した

            };
          }),
        };
      }),
    };
  }

  /* ---------- 一覧の編集（すべて新しいオブジェクトを返す） ---------- */

  /** URL を正規化する。スキームがなければ https:// を補う。無効なら null */
  function normalizeUrl(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch (e) {
      return null;
    }
  }

  function findCategory(data, catId) {
    return data.categories.find(function (c) { return c.id === catId; }) || null;
  }

  function findSiteLocation(data, siteId) {
    for (let ci = 0; ci < data.categories.length; ci++) {
      const sites = data.categories[ci].sites;
      for (let si = 0; si < sites.length; si++) if (sites[si].id === siteId) return { ci: ci, si: si };
    }
    return null;
  }

  function moveItem(arr, from, delta) {
    const to = from + delta;
    if (from < 0 || to < 0 || to >= arr.length) return false;
    const item = arr.splice(from, 1)[0];
    arr.splice(to, 0, item);
    return true;
  }

  function addCategory(data, name) {
    const d = clone(data);
    d.categories.push({ id: genId('cat'), name: String(name || '').trim() || '新しいカテゴリ', sites: [] });
    return d;
  }

  function renameCategory(data, catId, name) {
    const d = clone(data);
    const c = findCategory(d, catId);
    if (c) c.name = String(name || '').trim() || c.name;
    return d;
  }

  function removeCategory(data, catId) {
    const d = clone(data);
    d.categories = d.categories.filter(function (c) { return c.id !== catId; });
    return d;
  }

  function moveCategory(data, catId, delta) {
    const d = clone(data);
    moveItem(d.categories, d.categories.findIndex(function (c) { return c.id === catId; }), delta);
    return d;
  }

  /** 戻り値: { ok, data, error } */
  function addSite(data, catId, name, url) {
    const href = normalizeUrl(url);
    if (!href) return { ok: false, data: data, error: 'URL が正しくありません' };
    const d = clone(data);
    const c = findCategory(d, catId);
    if (!c) return { ok: false, data: data, error: 'カテゴリが見つかりません' };
    let label = String(name || '').trim();
    if (!label) {
      try { label = new URL(href).hostname; } catch (e) { label = href; }
    }
    c.sites.push({ id: genId('site'), name: label, url: href });
    return { ok: true, data: d, error: null };
  }

  /** patch: { name?, url? }。戻り値: { ok, data, error } */
  function updateSite(data, siteId, patch) {
    const d = clone(data);
    const loc = findSiteLocation(d, siteId);
    if (!loc) return { ok: false, data: data, error: 'サイトが見つかりません' };
    const site = d.categories[loc.ci].sites[loc.si];
    if (patch.url !== undefined) {
      const href = normalizeUrl(patch.url);
      if (!href) return { ok: false, data: data, error: 'URL が正しくありません' };
      site.url = href;
    }
    if (patch.name !== undefined) site.name = String(patch.name).trim() || site.name;
    if (patch.noFeedCheck !== undefined) {
      if (patch.noFeedCheck) site.noFeedCheck = true;
      else delete site.noFeedCheck;
    }
    return { ok: true, data: d, error: null };
  }

  function removeSite(data, siteId) {
    const d = clone(data);
    d.categories.forEach(function (c) {
      c.sites = c.sites.filter(function (x) { return x.id !== siteId; });
    });
    return d;
  }

  /** カテゴリ内で上下に動かす。端では隣のカテゴリへ移る */
  function moveSite(data, siteId, delta) {
    const d = clone(data);
    const loc = findSiteLocation(d, siteId);
    if (!loc) return d;
    const sites = d.categories[loc.ci].sites;
    if (moveItem(sites, loc.si, delta)) return d;
    const nci = loc.ci + delta;
    if (nci < 0 || nci >= d.categories.length) return d;
    const site = sites.splice(loc.si, 1)[0];
    if (delta < 0) d.categories[nci].sites.push(site);
    else d.categories[nci].sites.unshift(site);
    return d;
  }

  /**
   * コピーされた文字から URL とタイトルを取り出す（iPhone版のコピー経由の登録用）。
   * 「URLだけ」でも「タイトル（改行）URL」でもよい。URL がなければ null
   */
  function parseSharedText(text) {
    const s = String(text || '');
    const m = s.match(/https?:\/\/[^\s<>"']+/i);
    if (!m) return null;
    const url = normalizeUrl(m[0]);
    if (!url) return null;
    const title = s.replace(m[0], ' ').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
    return { title: title, url: url };
  }

  /* ---------- YouTube チャンネルの新着チェック（PC版で使用） ---------- */

  /**
   * URL が YouTube のチャンネルページなら、その手がかりを返す。違えば null
   *   { channelId } … /channel/UC... の形（そのまま使える）
   *   { pageUrl }   … /@名前・/c/名前・/user/名前 の形（ページからチャンネルIDを調べる）
   */
  function youTubeChannelRef(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (!/^(www\.|m\.)?youtube\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    if (parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1] || '')) return { channelId: parts[1] };
    if (/^@[^/]+$/.test(parts[0]) || ((parts[0] === 'c' || parts[0] === 'user') && parts[1])) {
      const base = parts[0].startsWith('@') ? parts[0] : parts[0] + '/' + parts[1];
      return { pageUrl: 'https://www.youtube.com/' + base };
    }
    return null;
  }

  function isYouTubeChannelUrl(url) {
    return !!youTubeChannelRef(url);
  }

  /** チャンネルページの HTML からチャンネルID（UC...）を取り出す。見つからなければ null */
  function extractChannelId(html) {
    const s = String(html || '');
    const patterns = [
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
      /"externalId":"(UC[\w-]{22})"/,
      /<meta itemprop="identifier" content="(UC[\w-]{22})"/,
      /"browseId":"(UC[\w-]{22})"/,
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = s.match(patterns[i]);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * チャンネルのフィード（RSS）を読む。ショート動画は除く（リンクが /shorts/ のもの）。
   * 戻り値: { latest: 最新動画の公開日時（ミリ秒）| null, videos: [{ id, t }]（公開の古い順） }
   */
  function parseYouTubeFeed(xml) {
    const re = /<entry>([\s\S]*?)<\/entry>/g;
    const videos = [];
    let m;
    while ((m = re.exec(String(xml || '')))) {
      const body = m[1];
      const pub = body.match(/<published>([^<]+)<\/published>/);
      const t = pub ? Date.parse(pub[1]) : NaN;
      if (isNaN(t)) continue;
      if (/<link rel="alternate" href="[^"]*\/shorts\//.test(body)) continue;
      const id = body.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/);
      videos.push({ id: id ? id[1] : null, t: t });
    }
    videos.sort(function (a, b) { return a.t - b.t; });
    return {
      latest: videos.length ? videos[videos.length - 1].t : null,
      videos: videos.filter(function (v) { return v.id; }),
    };
  }

  /** 最新動画（ショートを除く）の公開日時（ミリ秒）。動画がなければ null */
  function parseYouTubeFeedLatest(xml) {
    return parseYouTubeFeed(xml).latest;
  }

  /**
   * 「次へ」で飛ばすサイトIDを求める。
   * 対象: YouTube のチャンネルで、新着チェックが有効、前回アプリから開いた後に新しい動画（ショートを除く）がないもの。
   * 一度も開いていない・確認できていないチャンネルは飛ばさない（新着ありとして扱う）。
   *   feedStatus: { [siteId]: { latest: ミリ秒|null, error } }
   *   lastViewed: { [siteId]: ミリ秒 }
   */
  function computeFeedSkip(data, feedStatus, lastViewed) {
    const fs = feedStatus || {};
    const lv = lastViewed || {};
    return flatten(data)
      .filter(function (e) {
        const site = e.site;
        if (site.noFeedCheck || !isYouTubeChannelUrl(site.url)) return false;
        const st = fs[site.id];
        const viewed = lv[site.id];
        if (!st || st.error || typeof viewed !== 'number') return false;
        return typeof st.latest !== 'number' || st.latest <= viewed;
      })
      .map(function (e) { return e.site.id; });
  }

  /** 前回アプリから開いた後に公開された動画（古い順）。分からなければ空 */
  function newVideos(st, viewed) {
    if (!st || st.error || typeof viewed !== 'number' || !Array.isArray(st.videos)) return [];
    return st.videos
      .filter(function (v) { return v && v.id && typeof v.t === 'number' && v.t > viewed; })
      .sort(function (a, b) { return a.t - b.t; });
  }

  /**
   * YouTube チャンネルを開くときの行き先。新着動画があれば、チャンネルページの代わりにその動画を開く。
   *   1本 → その動画 / 複数 → 古い順に並べた一時プレイリスト（続けて再生される）
   * 戻り値: { url, count, viewedAt（前回閲覧日時として記録する値）} / 新着を開かないときは null
   * viewedAt は「フィードを確認した日時」。確認の後に出た動画を次回の新着として残すため。
   */
  function feedOpenTarget(site, st, viewed) {
    if (!site || site.noFeedCheck || !isYouTubeChannelUrl(site.url)) return null;
    if (!st || (st.url && st.url !== site.url)) return null;
    const list = newVideos(st, viewed);
    if (list.length === 0) return null;
    const ids = list.map(function (v) { return v.id; });
    return {
      url: ids.length === 1
        ? 'https://www.youtube.com/watch?v=' + ids[0]
        : 'https://www.youtube.com/watch_videos?video_ids=' + ids.join(','),
      count: ids.length,
      viewedAt: typeof st.checkedAt === 'number' ? st.checkedAt : Date.now(),
    };
  }

  /** 編集画面に出す、新着チェックの状況の説明文 */
  function describeFeedStatus(st, viewed) {
    const fmt = function (t) {
      const d = new Date(t);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    };
    if (!st) return '確認待ち';
    if (st.error) return '確認できませんでした（' + st.error + '）→ 飛ばしません';
    if (typeof st.latest !== 'number') {
      return '動画がありません（ショートは数えません）' + (typeof viewed === 'number' ? ' → 新着なし（飛ばす）' : '');
    }
    const head = '最新動画 ' + fmt(st.latest);
    if (typeof viewed !== 'number') return head + '・まだアプリから開いていません';
    if (st.latest <= viewed) return head + '・前回 ' + fmt(viewed) + ' → 新着なし（飛ばす）';
    const n = newVideos(st, viewed).length;
    return head + '・前回 ' + fmt(viewed) + ' → 新着あり' + (n > 0 ? '（' + n + '本を古い順に再生）' : '');
  }

  /* ---------- JSON の書き出し・読み込み ---------- */

  function exportJson(data) {
    return JSON.stringify(
      {
        app: 'net-routine',
        version: DATA_VERSION,
        categories: data.categories.map(function (c) {
          return {
            name: c.name,
            sites: c.sites.map(function (x) {
              const o = { name: x.name, url: x.url };
              if (x.noFeedCheck) o.noFeedCheck = true;
              return o;
            }),
          };
        }),
      },
      null,
      2
    );
  }

  /** 文字列またはオブジェクトを検証し、ID を振り直したデータを返す。戻り値: { ok, data, error } */
  function validateImport(input) {
    let obj = input;
    if (typeof input === 'string') {
      try {
        obj = JSON.parse(input);
      } catch (e) {
        return { ok: false, data: null, error: 'JSON として読めません' };
      }
    }
    if (!obj || !Array.isArray(obj.categories)) {
      return { ok: false, data: null, error: 'categories（カテゴリの配列）がありません' };
    }
    const d = emptyData();
    for (let i = 0; i < obj.categories.length; i++) {
      const c = obj.categories[i];
      if (!c || typeof c.name !== 'string' || !c.name.trim()) {
        return { ok: false, data: null, error: (i + 1) + '番目のカテゴリに name がありません' };
      }
      const sites = Array.isArray(c.sites) ? c.sites : [];
      const outSites = [];
      for (let j = 0; j < sites.length; j++) {
        const x = sites[j] || {};
        const href = normalizeUrl(x.url);
        if (!href) {
          return { ok: false, data: null, error: '「' + c.name + '」の' + (j + 1) + '番目のサイトの URL が正しくありません' };
        }
        const name = typeof x.name === 'string' && x.name.trim() ? x.name.trim() : new URL(href).hostname;
        const out = { id: genId('site'), name: name, url: href };
        if (x.noFeedCheck === true) out.noFeedCheck = true;
        outSites.push(out);
      }
      d.categories.push({ id: genId('cat'), name: c.name.trim(), sites: outSites });
    }
    return { ok: true, data: d, error: null };
  }

  return {
    RESET_HOUR: RESET_HOUR,
    getDayKey: getDayKey,
    emptyData: emptyData,
    emptyState: emptyState,
    flatten: flatten,
    normalizeState: normalizeState,
    applyAction: applyAction,
    toggleVisited: toggleVisited,
    progress: progress,
    getView: getView,
    normalizeUrl: normalizeUrl,
    addCategory: addCategory,
    renameCategory: renameCategory,
    removeCategory: removeCategory,
    moveCategory: moveCategory,
    addSite: addSite,
    updateSite: updateSite,
    removeSite: removeSite,
    moveSite: moveSite,
    parseSharedText: parseSharedText,
    youTubeChannelRef: youTubeChannelRef,
    isYouTubeChannelUrl: isYouTubeChannelUrl,
    extractChannelId: extractChannelId,
    parseYouTubeFeed: parseYouTubeFeed,
    parseYouTubeFeedLatest: parseYouTubeFeedLatest,
    computeFeedSkip: computeFeedSkip,
    newVideos: newVideos,
    feedOpenTarget: feedOpenTarget,
    describeFeedStatus: describeFeedStatus,
    exportJson: exportJson,
    validateImport: validateImport,
  };
});
