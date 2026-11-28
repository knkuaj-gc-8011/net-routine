// ネットルーティン iPhone アプリ（Expo Go で動く版）
// サイトをアプリの中で表示し、画面下にナビを重ねる。自動巡回・YouTube の新着チェックも行う。
import { useEffect, useRef, useState } from 'react';
import { Appearance, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import C from './src/core';
import { loadAll, save } from './src/storage';
import { checkFeeds } from './src/feeds';
import WebFrame from './src/WebFrame';
import Editor from './src/Editor';
import { colors } from './src/theme';

// アプリ全体をダークモードにする。アプリ内ブラウザもダーク扱いになり、ダークモード対応のサイトは暗く表示される
try { Appearance.setColorScheme('dark'); } catch (e) { /* 古い環境では何もしない */ }

const FEED_INTERVAL = 30 * 60 * 1000; // 30分ごとに新着を確認
const TOAST_MS = 3500;

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function statusText(v) {
  if (v.total === 0) return { title: 'サイトが登録されていません', sub: '「編集」から登録するか、PC版の JSON を読み込んでください' };
  if (v.finished && v.remaining === 0 && v.current) return { title: v.current.siteName, sub: '🎉 今日の巡回完了 ・ ' + v.current.categoryName };
  if (v.finished) {
    return v.remaining > 0
      ? { title: '巡回の最後まで来ました', sub: '未訪問 ' + v.remaining + '件（一覧から開けます）' }
      : { title: '🎉 今日の巡回完了', sub: '全' + v.total + 'サイトをチェックしました' };
  }
  if (!v.current) return { title: '巡回を始めましょう', sub: '「次へ」で最初の未訪問サイトを開きます' };
  const cp = v.current.catProgress;
  return { title: v.current.siteName, sub: v.current.categoryName + '（' + cp.visited + '/' + cp.total + '）' + (v.current.noNew ? ' ・ 新着動画なし' : '') };
}

// 円いチェック（PC版と同じ色分け）
function CheckCircle({ visited, noNew, noNewVisited, size, onPress }) {
  const quiet = noNew || (visited && noNewVisited);
  const bg = quiet ? colors.quiet : visited ? colors.ok : 'transparent';
  const fg = visited ? '#fff' : '#111';
  return (
    <Pressable onPress={onPress} hitSlop={8}
      style={[st.check, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, borderColor: quiet ? colors.quiet : visited ? colors.ok : colors.border }]}>
      {visited || noNew ? <Text style={{ color: fg, fontWeight: '700', fontSize: size * 0.5 }}>✓</Text> : null}
    </Pressable>
  );
}

// ナビのボタン（アイコンだけ。名前は読み上げ用に持たせる）
function NavBtn({ icon, label, onPress, primary, disabled, flex }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} accessibilityRole="button"
      style={({ pressed }) => [st.navBtn, { flex: flex || 1 }, primary && st.navPrimary, disabled && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}>
      <Text style={[st.navIcon, primary && { color: '#fff' }]}>{icon}</Text>
    </Pressable>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const [store, setStore] = useState({ data: C.emptyData(), state: null, lastViewed: {}, feedStatus: {}, autoOn: false, forceDark: true });
  const ref = useRef(store); // タイマーなどから最新の値を読むため
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(null); // { url, key } 表示中のサイト
  const [curPage, setCurPage] = useState(null); // アプリ内ブラウザで今見ているページ { url, title }
  const [mode, setMode] = useState('routine'); // routine | list | edit
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [left, setLeft] = useState(null); // 自動巡回の残り秒数

  function update(patch) {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setStore(next);
    Object.keys(patch).forEach((k) => save(k, patch[k]));
  }

  function openUrl(url) {
    setPage({ url, key: Date.now() + Math.random() });
    setCurPage({ url, title: '' });
  }

  const toastTimer = useRef(null);
  function showToast(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  // YouTube の新着確認（同時に1回だけ）
  const feedRunning = useRef(null);
  function refreshFeeds(force) {
    if (feedRunning.current) return feedRunning.current;
    const p = checkFeeds(ref.current.data, ref.current.feedStatus, force)
      .then((fs) => update({ feedStatus: fs }))
      .catch(() => {})
      .finally(() => { feedRunning.current = null; });
    feedRunning.current = p;
    return p;
  }

  // 起動時: 保存した内容を読み、今日の途中なら最後に開いていたものを開き直す（チェックは変えない）
  useEffect(() => {
    (async () => {
      const r = await loadAll();
      const data = r.data || C.emptyData();
      const next = {
        data,
        state: C.normalizeState(r.state, data, new Date()),
        lastViewed: r.lastViewed || {},
        feedStatus: r.feedStatus || {},
        autoOn: !!r.autoOn,
        forceDark: r.forceDark !== false, // 既定はオン
      };
      ref.current = next;
      setStore(next);
      const cur = next.state.currentSiteId && C.flatten(data).find((e) => e.site.id === next.state.currentSiteId);
      if (cur) openUrl(r.lastOpened && r.lastOpened.siteId === cur.site.id ? r.lastOpened.url : cur.site.url);
      setLoaded(true);
      refreshFeeds();
    })();
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (s === 'active') refreshFeeds();
    });
    const timer = setInterval(() => refreshFeeds(), FEED_INTERVAL);
    return () => { sub.remove(); clearInterval(timer); };
  }, []);

  const skipOf = (s) => C.computeFeedSkip(s.data, s.feedStatus, s.lastViewed);

  async function act(action) {
    if (action.type === 'start') {
      // 巡回開始のときは、新着を確認してから始める（最大6秒待つ）
      setBusy(true);
      await Promise.race([refreshFeeds(), new Promise((r) => setTimeout(r, 6000))]);
      setBusy(false);
    }
    const s = ref.current;
    const res = C.applyAction(s.data, s.state, action, new Date(), { skip: skipOf(s) });
    const patch = {};
    if (!res.noop) patch.state = res.state;
    if (res.entry) {
      // YouTube チャンネルに新着動画があれば、チャンネルページの代わりに新着を古い順に再生する
      const site = res.entry.site;
      const t = C.feedOpenTarget(site, s.feedStatus[site.id], s.lastViewed[site.id]);
      patch.lastViewed = { ...s.lastViewed, [site.id]: t ? t.viewedAt : Date.now() };
      const url = t ? t.url : site.url;
      patch.lastOpened = { siteId: site.id, url };
      openUrl(url);
    }
    if (Object.keys(patch).length) update(patch);
    if (res.notice) showToast(res.notice);
  }
  const actRef = useRef(act);
  actRef.current = act;

  function toggle(siteId) {
    const s = ref.current;
    update({ state: C.toggleVisited(s.data, s.state, siteId, new Date(), { skip: skipOf(s) }) });
  }

  const view = C.getView(store.data, store.state, new Date(), { skip: skipOf(store) });
  const cur = view.current;

  /* ---------- 自動巡回: 自動巡回のカテゴリでは、表示秒数ごとに「次へ」と同じ動きをする ---------- */
  const autoSec = store.autoOn && cur && cur.autoSeconds && page ? cur.autoSeconds : null;
  // 一覧・編集を開いている間、アプリが裏にある間は止める
  const paused = mode !== 'routine' || !appActive || busy;
  const autoRef = useRef(null); // { key, left }
  useEffect(() => {
    if (!autoSec) { autoRef.current = null; setLeft(null); return; }
    const key = cur.siteId + ':' + page.key; // サイトを開き直したら数え直す
    if (!autoRef.current || autoRef.current.key !== key) {
      autoRef.current = { key, left: autoSec };
      setLeft(autoSec);
    }
  }, [autoSec, cur && cur.siteId, page && page.key]);
  useEffect(() => {
    if (!autoSec || paused) return undefined;
    const h = setInterval(() => {
      const a = autoRef.current;
      if (!a) return;
      a.left -= 1;
      setLeft(a.left);
      if (a.left <= 0) {
        autoRef.current = null;
        actRef.current({ type: 'next' });
      }
    }, 1000);
    return () => clearInterval(h);
  }, [autoSec, paused]);

  if (!loaded) return <View style={[st.root, { paddingTop: insets.top }]} />;

  const text = statusText(view);
  const progress = view.visitedCount + '/' + view.total + (view.noNewCount ? '（新着なし ' + view.noNewCount + '）' : '');
  const autoText = autoSec && left != null ? '自動 あと' + left + '秒' + (paused ? '（停止中）' : '') : null;

  return (
    <View style={st.root}>
      <StatusBar style="light" />
      <View style={{ height: insets.top, backgroundColor: colors.navBg }} />
      <View style={st.content}>
        {page ? (
          <WebFrame key={page.key} url={page.url} forceDark={store.forceDark} onPage={setCurPage} onOpenWindow={(u) => u && openUrl(u)} />
        ) : (
          <View style={st.start}>
            <Text style={st.startTitle}>{text.title}</Text>
            <Text style={st.startSub}>{busy ? 'YouTube の新着を確認中…' : text.sub}</Text>
            {view.total > 0 ? (
              <Pressable style={[st.bigBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => act(view.finished ? { type: 'next' } : { type: 'start' })}>
                <Text style={st.bigBtnText}>{view.finished ? '最初のサイトを開く' : view.started ? '続きから' : '巡回を開始'}</Text>
              </Pressable>
            ) : (
              <Pressable style={st.bigBtn} onPress={() => setMode('edit')}>
                <Text style={st.bigBtnText}>編集を開く</Text>
              </Pressable>
            )}
          </View>
        )}

        {mode === 'list' ? (
          <View style={st.sheet}>
            <View style={st.sheetHead}>
              <Text style={st.sheetTitle}>一覧 {progress}</Text>
              <Pressable onPress={() => setMode('routine')} style={st.sheetClose}><Text style={st.sheetCloseText}>閉じる</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {view.categories.map((cat) => (
                <View key={cat.id} style={st.listCat}>
                  <Text style={st.listCatTitle}>{cat.name} <Text style={st.muted}>{cat.visited}/{cat.total}</Text></Text>
                  {cat.sites.map((x) => (
                    <View key={x.id} style={[st.listRow, x.current && { backgroundColor: colors.hl }]}>
                      <CheckCircle size={26} visited={x.visited} noNew={x.noNew} noNewVisited={x.noNewVisited} onPress={() => toggle(x.id)} />
                      <Pressable style={{ flex: 1, paddingVertical: 10 }} onPress={() => { setMode('routine'); act({ type: 'goto', siteId: x.id }); }}>
                        <Text numberOfLines={1} style={[st.listName, (x.visited || x.noNew) && { color: colors.muted }]}>{x.name}</Text>
                      </Pressable>
                      {x.noNew ? <Text style={st.badge}>新着なし</Text> : null}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {toast ? (
          <View pointerEvents="none" style={st.toastWrap}>
            <Text style={st.toast}>{toast}</Text>
          </View>
        ) : null}

        {collapsed ? (
          <View style={[st.pill, { bottom: 12 + insets.bottom }]}>
            <Pressable onPress={() => setCollapsed(false)} style={st.pillBtn}>
              <Text style={st.pillText}>▲ {view.visitedCount}/{view.total}{autoText ? ' ・' + autoText : ''}</Text>
            </Pressable>
            <Pressable onPress={() => act({ type: 'next' })} style={[st.pillBtn, st.navPrimary]}>
              <Text style={[st.pillText, { color: '#fff', fontWeight: '600' }]}>次へ ▶</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {!collapsed ? (
        <View style={[st.nav, { paddingBottom: Math.max(insets.bottom - 20, 4) }]}>{/* ボタンをできるだけ下に寄せる */}
          <View style={st.navTop}>
            <View style={[st.navInfo, { flex: 4.6 }]}>
              <Pressable onPress={() => setCollapsed(true)} hitSlop={8} style={st.collapse}><Text style={st.muted}>▼</Text></Pressable>
              {cur ? <CheckCircle size={30} visited={cur.visited} noNew={cur.noNew} noNewVisited={cur.noNewVisited} onPress={() => toggle(cur.siteId)} /> : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={st.navTitle}>{text.title}</Text>
                <Text numberOfLines={1} style={st.navSub}>{autoText ? autoText + ' ・ ' : ''}{text.sub} ・ {progress}</Text>
              </View>
            </View>
            {/* 「一覧」ボタンの上に「自動巡回ON」 */}
            <Pressable onPress={() => update({ autoOn: !store.autoOn })} style={[st.autoBox, store.autoOn && st.autoBoxOn]} hitSlop={4}>
              <View style={[st.autoTick, store.autoOn && st.autoTickOn]}>{store.autoOn ? <Text style={st.autoTickMark}>✓</Text> : null}</View>
              <Text style={st.autoText}>自動巡回ON</Text>
            </Pressable>
          </View>
          <View style={st.navBtns}>
            <NavBtn icon="◀" label="前へ" onPress={() => act({ type: 'prev' })} disabled={!view.canPrev} />
            <NavBtn icon="✎" label="編集" onPress={() => setMode('edit')} />
            <NavBtn icon="▶" label="次へ" primary flex={1.6} onPress={() => act({ type: view.started || cur ? 'next' : 'start' })} disabled={!view.canNext || busy} />
            <NavBtn icon="⏭" label="次カテゴリ" onPress={() => act({ type: 'nextCategory' })} disabled={!view.canNextCategory} />
            <NavBtn icon="☰" label="一覧" onPress={() => setMode(mode === 'list' ? 'routine' : 'list')} />
          </View>
        </View>
      ) : null}

      {mode === 'edit' ? (
        <View style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: colors.bg }]}>
          <Editor
            data={store.data}
            feedStatus={store.feedStatus}
            lastViewed={store.lastViewed}
            currentPage={curPage}
            forceDark={store.forceDark}
            onForceDark={(v) => update({ forceDark: v })}
            onSave={(d) => {
              update({ data: d, state: C.normalizeState(ref.current.state, d, new Date()) });
              refreshFeeds();
            }}
            onClose={() => setMode('routine')}
          />
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  muted: { color: colors.muted, fontWeight: '400' },
  start: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  startTitle: { fontSize: 20, fontWeight: '700', color: colors.fg, textAlign: 'center' },
  startSub: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  bigBtn: { marginTop: 8, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14 },
  bigBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  nav: { backgroundColor: colors.navBg, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingTop: 6, gap: 6 },
  navTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  collapse: { paddingHorizontal: 2 },
  navTitle: { fontWeight: '600', fontSize: 15, color: colors.fg },
  navSub: { fontSize: 12, color: colors.muted },
  check: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  autoBox: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 4, gap: 2, backgroundColor: colors.card },
  autoBoxOn: { borderColor: colors.primary },
  autoTick: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  autoTickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  autoTickMark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  autoText: { fontSize: 9, color: colors.fg },
  navBtns: { flexDirection: 'row', gap: 6 },
  navBtn: { height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', gap: 2 },
  navPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  navIcon: { fontSize: 18, color: colors.fg },
  sheet: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  sheetTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.fg },
  sheetClose: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary },
  sheetCloseText: { color: '#fff', fontWeight: '600' },
  listCat: { marginHorizontal: 12, marginTop: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  listCatTitle: { fontSize: 14, fontWeight: '600', color: colors.muted, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  listName: { fontSize: 16, color: colors.fg },
  badge: { fontSize: 11, color: colors.muted, borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden' },
  toastWrap: { position: 'absolute', left: 16, right: 16, bottom: 12, alignItems: 'center' },
  toast: { backgroundColor: colors.toastBg, color: colors.toastFg, fontSize: 14, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, overflow: 'hidden', textAlign: 'center' },
  pill: { position: 'absolute', right: 12, flexDirection: 'row', gap: 4, padding: 4, backgroundColor: colors.navBg, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  pillBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pillText: { fontSize: 14, color: colors.fg },
});
