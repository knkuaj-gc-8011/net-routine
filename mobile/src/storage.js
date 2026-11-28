// 端末への保存（AsyncStorage）。値は JSON で保存する
import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEYS = {
  data: 'nr.data', // 一覧
  state: 'nr.state', // 今日の状態（毎朝5時リセット）
  lastViewed: 'nr.lastViewed', // { siteId: アプリから最後に開いた日時 }（YouTube の新着判定の基準）
  feedStatus: 'nr.feedStatus', // { siteId: { url, channelId, latest, videos, checkedAt, error } }
  autoOn: 'nr.autoOn', // ナビの「自動巡回ON」
  lastOpened: 'nr.lastOpened', // { siteId, url } 最後に開いたもの（起動時に開き直す）
};

export async function loadAll() {
  const keys = Object.values(KEYS);
  const pairs = await AsyncStorage.multiGet(keys);
  const out = {};
  for (const [k, v] of pairs) {
    const name = Object.keys(KEYS).find((n) => KEYS[n] === k);
    try {
      out[name] = v == null ? null : JSON.parse(v);
    } catch (e) {
      out[name] = null;
    }
  }
  return out;
}

export function save(name, value) {
  return AsyncStorage.setItem(KEYS[name], JSON.stringify(value)).catch(() => {});
}
