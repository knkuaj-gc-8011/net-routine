// サイトを表示する枠。iPhone ではアプリ内ブラウザ（WebView）を使う
import { WebView } from 'react-native-webview';

// YouTube などが「対応していないブラウザ」扱いしないよう、Safari と同じ表記を付け足す
const UA_SUFFIX = 'Version/18.0 Mobile/15E148 Safari/604.1';

export default function WebFrame({ url, onPage, onOpenWindow }) {
  return (
    <WebView
      source={{ uri: url }}
      style={{ flex: 1 }}
      applicationNameForUserAgent={UA_SUFFIX}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsBackForwardNavigationGestures // 左右のスワイプでページを戻る・進む
      pullToRefreshEnabled
      sharedCookiesEnabled
      // 新しいウィンドウで開くリンクは、同じ画面で開く
      onOpenWindow={(e) => onOpenWindow && onOpenWindow(e.nativeEvent.targetUrl)}
      onNavigationStateChange={(nav) => onPage && onPage({ url: nav.url, title: nav.title })}
    />
  );
}
