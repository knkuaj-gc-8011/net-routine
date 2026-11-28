// PC のブラウザで動作確認するとき用（iPhone では使わない）。WebView の代わりに iframe で表示する
import { useEffect } from 'react';

export default function WebFrame({ url, onPage }) {
  useEffect(() => {
    if (onPage) onPage({ url, title: '' });
  }, [url]);
  return <iframe title="site" src={url} style={{ flex: 1, border: 'none', width: '100%', height: '100%' }} />;
}
