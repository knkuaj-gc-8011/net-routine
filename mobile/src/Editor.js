// 編集画面: カテゴリとサイトの編集、自動巡回の設定、JSON の読み込み・書き出し
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import C from './core';
import { colors } from './theme';

function Btn({ label, onPress, kind, disabled, small }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn, small && s.btnSmall,
        kind === 'primary' && s.btnPrimary, kind === 'danger' && s.btnDanger,
        disabled && { opacity: 0.4 }, pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={[s.btnText, kind === 'primary' && { color: '#fff', fontWeight: '600' }, kind === 'danger' && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

function Check({ checked, label, onChange }) {
  return (
    <Pressable onPress={() => onChange(!checked)} style={s.checkRow} hitSlop={6}>
      <View style={[s.checkBox, checked && s.checkBoxOn]}>{checked ? <Text style={s.checkMark}>✓</Text> : null}</View>
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  );
}

// 入力欄。確定（キーボードを閉じる・別の欄へ移る）したときに onCommit を呼ぶ。false が返ったら元の値に戻す
function Field({ value, onCommit, style, ...rest }) {
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) { // 外から値が変わったら合わせる
    setBase(value);
    setText(value);
  }
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onEndEditing={() => { if (text !== value && onCommit(text) === false) setText(value); }}
      style={[s.input, style]}
      placeholderTextColor={colors.muted}
      keyboardAppearance="dark"
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
    />
  );
}

export default function Editor({ data, feedStatus, lastViewed, currentPage, forceDark, onForceDark, onSave, onClose }) {
  const [message, setMessage] = useState(null); // { text, error }
  const [drafts, setDrafts] = useState({}); // 追加欄の書きかけ { catId: { name, url } }

  const commit = (next) => { setMessage(null); onSave(next); };
  const fail = (text) => setMessage({ text, error: true });
  const page = currentPage && /^https?:/i.test(currentPage.url || '') ? currentPage : null;
  const pageLabel = page ? (page.title ? page.title + '\n' : '') + page.url : 'サイトを表示していません';

  function setFromPage(site) {
    if (!page) return fail('見ているページがありません。巡回画面でページを開いてから押してください');
    const r = C.updateSite(data, site.id, { url: page.url });
    if (!r.ok) return fail(r.error);
    commit(r.data);
    setMessage({ text: '「' + site.name + '」の URL を今のページにしました', error: false });
  }

  function addSite(cat, fromPage) {
    const d = drafts[cat.id] || {};
    const r = fromPage ? C.addSite(data, cat.id, page ? page.title : '', page ? page.url : '') : C.addSite(data, cat.id, d.name, d.url);
    if (fromPage && !page) return fail('見ているページがありません。巡回画面でページを開いてから押してください');
    if (!r.ok) return fail(r.error);
    setDrafts({ ...drafts, [cat.id]: {} });
    commit(r.data);
    if (fromPage) setMessage({ text: '「' + cat.name + '」に追加しました: ' + (page.title || page.url), error: false });
  }

  async function copyJson() {
    await Clipboard.setStringAsync(C.exportJson(data));
    setMessage({ text: 'JSON をコピーしました（メモなどに貼って保存・PC版へ移せます）', error: false });
  }

  async function importJson() {
    const text = await Clipboard.getStringAsync();
    if (!text) return fail('クリップボードが空です（または貼り付けが許可されませんでした）。PC版の編集画面で「コピー」してから押してください');
    const r = C.validateImport(text);
    if (!r.ok) return fail('読み込めませんでした: ' + r.error);
    const count = C.flatten(r.data).length;
    Alert.alert('JSON を読み込みます', r.data.categories.length + 'カテゴリ・' + count + 'サイト。今の一覧は置き換わります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '読み込む', style: 'destructive', onPress: () => { commit(r.data); setMessage({ text: '読み込みました（' + count + 'サイト）', error: false }); } },
    ]);
  }

  function confirmRemove(title, onOk) {
    Alert.alert(title, '', [{ text: 'やめる', style: 'cancel' }, { text: '削除', style: 'destructive', onPress: onOk }]);
  }

  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text style={s.headTitle}>編集</Text>
        <Btn label="閉じる" kind="primary" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.pageBox}>
          <Text style={s.muted}>見ているページ（「今のページ」ボタンで登録できます）</Text>
          <Text style={s.pageText} numberOfLines={3}>{pageLabel}</Text>
        </View>
        {message ? <Text style={[s.msg, message.error && s.msgError]}>{message.text}</Text> : null}
        <View style={s.pageBox}>
          <Check checked={forceDark} label="ダークモード非対応のサイトも暗く表示する（色を反転）" onChange={onForceDark} />
          <Text style={[s.muted, s.small]}>ダークモード対応のサイトは、この設定に関係なく暗く表示されます。変更は次に開いたページから反映されます。</Text>
        </View>

        {data.categories.map((cat) => {
          const auto = !!cat.auto;
          const d = drafts[cat.id] || {};
          return (
            <View key={cat.id} style={s.cat}>
              <View style={s.row}>
                <Field value={cat.name} style={[s.flex, s.catName]} onCommit={(v) => commit(C.renameCategory(data, cat.id, v))} />
                <Btn small label="▲" onPress={() => commit(C.moveCategory(data, cat.id, -1))} />
                <Btn small label="▼" onPress={() => commit(C.moveCategory(data, cat.id, 1))} />
                <Btn small label="✕" kind="danger" onPress={() => confirmRemove('カテゴリ「' + cat.name + '」と中のサイト' + cat.sites.length + '件を削除しますか？', () => commit(C.removeCategory(data, cat.id)))} />
              </View>
              <View style={s.autoRow}>
                <Check checked={auto} label="自動巡回" onChange={(v) => commit(C.updateCategoryAuto(data, cat.id, { auto: v }).data)} />
                <Text style={[s.autoLabel, !auto && s.muted]}>表示秒数</Text>
                <Field
                  value={String(C.parseAutoSeconds(cat.autoSeconds) || 10)}
                  editable={auto}
                  keyboardType="number-pad"
                  maxLength={2}
                  style={[s.secInput, !auto && s.disabledInput]}
                  onCommit={(v) => {
                    const r = C.updateCategoryAuto(data, cat.id, { autoSeconds: v });
                    if (!r.ok) { fail(r.error); return false; } // 元の値に戻す
                    commit(r.data);
                  }}
                />
                <Text style={[s.autoLabel, !auto && s.muted]}>秒</Text>
              </View>

              {cat.sites.map((site) => {
                const isYt = C.isYouTubeChannelUrl(site.url);
                const feedOn = !site.noFeedCheck;
                return (
                  <View key={site.id} style={s.site}>
                    <Field value={site.name} placeholder="サイト名" onCommit={(v) => commit(C.updateSite(data, site.id, { name: v }).data)} />
                    <Field
                      value={site.url}
                      placeholder="URL"
                      keyboardType="url"
                      onCommit={(v) => {
                        const r = C.updateSite(data, site.id, { url: v });
                        if (!r.ok) { fail(r.error); return false; }
                        commit(r.data);
                      }}
                    />
                    <View style={s.row}>
                      <Btn small label="今のページ" onPress={() => setFromPage(site)} />
                      <View style={s.flex} />
                      <Btn small label="▲" onPress={() => commit(C.moveSite(data, site.id, -1))} />
                      <Btn small label="▼" onPress={() => commit(C.moveSite(data, site.id, 1))} />
                      <Btn small label="✕" kind="danger" onPress={() => confirmRemove('「' + site.name + '」を削除しますか？', () => commit(C.removeSite(data, site.id)))} />
                    </View>
                    {isYt ? (
                      <View>
                        <Check checked={feedOn} label="新着チェック（新しい動画がなければ「次へ」で飛ばす）" onChange={(v) => commit(C.updateSite(data, site.id, { noFeedCheck: !v }).data)} />
                        {feedOn ? <Text style={[s.muted, s.small]}>{C.describeFeedStatus((feedStatus || {})[site.id], (lastViewed || {})[site.id])}</Text> : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              <View style={[s.site, s.addBox]}>
                <TextInput keyboardAppearance="dark" style={s.input} placeholder="サイト名（省略可）" placeholderTextColor={colors.muted} value={d.name || ''} onChangeText={(v) => setDrafts({ ...drafts, [cat.id]: { ...d, name: v } })} />
                <TextInput keyboardAppearance="dark" style={s.input} placeholder="URL" placeholderTextColor={colors.muted} keyboardType="url" autoCapitalize="none" autoCorrect={false} value={d.url || ''} onChangeText={(v) => setDrafts({ ...drafts, [cat.id]: { ...d, url: v } })} />
                <View style={s.row}>
                  <Btn small label="追加" kind="primary" onPress={() => addSite(cat, false)} />
                  <Btn small label="今のページを追加" onPress={() => addSite(cat, true)} />
                </View>
              </View>
            </View>
          );
        })}
        <Btn label="＋ カテゴリを追加" kind="primary" onPress={() => commit(C.addCategory(data, '新しいカテゴリ'))} />

        <View style={s.io}>
          <Text style={s.ioTitle}>一覧の移動（JSON）</Text>
          <Text style={s.muted}>PC版の編集画面で「コピー」した JSON を、メモなどからコピーして「読み込む」を押してください。</Text>
          <View style={s.row}>
            <Btn label="コピーした JSON を読み込む" onPress={importJson} />
          </View>
          <View style={s.row}>
            <Btn label="この一覧を JSON でコピー" onPress={copyJson} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  headTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.fg },
  body: { padding: 12, gap: 12, paddingBottom: 60 },
  pageBox: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 2 },
  pageText: { color: colors.fg, fontSize: 13 },
  msg: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.fg },
  msgError: { borderColor: colors.danger, color: colors.danger },
  cat: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  flex: { flex: 1 },
  catName: { fontWeight: '600' },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  autoLabel: { color: colors.fg, fontSize: 14 },
  secInput: { width: 52, textAlign: 'center', paddingVertical: 6 },
  disabledInput: { opacity: 0.4 },
  site: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: colors.border },
  addBox: { borderStyle: 'dashed' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 8, fontSize: 16, color: colors.fg, backgroundColor: colors.bg },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, alignItems: 'center' },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 6 },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnDanger: {},
  btnText: { color: colors.fg, fontSize: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  checkBox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontWeight: '700', fontSize: 13 },
  checkLabel: { color: colors.fg, fontSize: 14, flexShrink: 1 },
  muted: { color: colors.muted, fontSize: 13 },
  small: { fontSize: 12 },
  io: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border },
  ioTitle: { fontSize: 16, fontWeight: '600', color: colors.fg },
});
