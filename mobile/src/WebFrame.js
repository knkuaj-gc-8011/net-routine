// サイトを表示する枠。iPhone ではアプリ内ブラウザ（WebView）を使う
import { useRef } from 'react';
import { WebView } from 'react-native-webview';
import { colors } from './theme';

// YouTube などが「対応していないブラウザ」扱いしないよう、Safari と同じ表記を付け足す
const UA_SUFFIX = 'Version/18.0 Mobile/15E148 Safari/604.1';

// ダークモードに対応していないサイト（背景が明るいまま）を、色の反転で暗くする。
// 写真・動画は二重に反転して元の色に戻す。後からサイト自身が暗くなった場合は反転をやめる
const FORCE_DARK_JS = `
(function () {
  if (window.__nrDark) return; window.__nrDark = true;
  var CSS = 'html{filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}' +
    'img,video,picture,canvas,iframe,embed,object,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}';
  function lum(c) {
    var m = String(c || '').match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?/);
    if (!m || (m[4] !== undefined && +m[4] < 0.1)) return null; // 透明
    return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255;
  }
  function check() {
    if (!document.body) return;
    var l = lum(getComputedStyle(document.body).backgroundColor);
    if (l === null) l = lum(getComputedStyle(document.documentElement).backgroundColor);
    if (l === null) l = 1; // 背景の指定がなければ白
    var el = document.getElementById('__nr_dark');
    if (l > 0.6 && !el) {
      el = document.createElement('style'); el.id = '__nr_dark'; el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    } else if (l <= 0.6 && el) {
      el.remove();
    }
  }
  check(); setTimeout(check, 1000); setTimeout(check, 3000);
})();
true;`;

export default function WebFrame({ url, onPage, onOpenWindow, forceDark }) {
  const ref = useRef(null);
  return (
    <WebView
      ref={ref}
      source={{ uri: url }}
      style={{ flex: 1, backgroundColor: colors.bg }}
      applicationNameForUserAgent={UA_SUFFIX}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsBackForwardNavigationGestures // 左右のスワイプでページを戻る・進む
      pullToRefreshEnabled
      sharedCookiesEnabled
      injectedJavaScript={forceDark ? FORCE_DARK_JS : undefined}
      // iOS では onMessage がないと injectedJavaScript が動かないことがあるため、空の受け口を置く
      onMessage={() => {}}
      // 念のため、読み込み完了時にも組み込む（二重に動いても1回分だけ効く）
      onLoadEnd={() => { if (forceDark && ref.current) ref.current.injectJavaScript(FORCE_DARK_JS); }}
      // 新しいウィンドウで開くリンクは、同じ画面で開く
      onOpenWindow={(e) => onOpenWindow && onOpenWindow(e.nativeEvent.targetUrl)}
      onNavigationStateChange={(nav) => onPage && onPage({ url: nav.url, title: nav.title })}
    />
  );
}
