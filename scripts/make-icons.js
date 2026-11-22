// アイコン（青地に白い「次へ」マーク）を PNG で生成する。外部ライブラリ不要。
// 使い方: node scripts/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BG = [37, 99, 235]; // #2563eb
const FG = [255, 255, 255];

// 0..1 の座標で、点が図形の内側かどうか
function insideMark(x, y) {
  // 右向きの三角形
  const tri = x >= 0.3 && x <= 0.62 && Math.abs(y - 0.5) <= (0.62 - x) * (0.22 / 0.32);
  // 縦棒
  const bar = x >= 0.66 && x <= 0.74 && y >= 0.28 && y <= 0.72;
  return tri || bar;
}

function insideRoundRect(x, y, r) {
  if (r <= 0) return true;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function render(size, radius) {
  const SS = 4; // 4x4 のスーパーサンプリングでなめらかにする
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let cover = 0;
      let mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (i + (sx + 0.5) / SS) / size;
          const y = (j + (sy + 0.5) / SS) / size;
          if (insideRoundRect(x, y, radius)) {
            cover++;
            if (insideMark(x, y)) mark++;
          }
        }
      }
      const n = SS * SS;
      const o = (j * size + i) * 4;
      const t = cover ? mark / cover : 0;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(BG[k] * (1 - t) + FG[k] * t);
      px[o + 3] = Math.round((cover / n) * 255);
    }
  }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(size, radius) {
  const px = render(size, radius);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) {
    raw[j * (size * 4 + 1)] = 0; // フィルタなし
    px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, '..');
const targets = [
  // iPhone は角丸を自動でかけるので、四角いまま・透過なし
  ['iphone/icons/apple-touch-icon.png', 180, 0],
  ['iphone/icons/icon-192.png', 192, 0],
  ['iphone/icons/icon-512.png', 512, 0],
  // Chrome 拡張は角丸にする
  ['extension/icons/icon16.png', 16, 0.18],
  ['extension/icons/icon32.png', 32, 0.18],
  ['extension/icons/icon48.png', 48, 0.18],
  ['extension/icons/icon128.png', 128, 0.18],
];
for (const [rel, size, radius] of targets) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(size, radius));
  console.log('作成: ' + rel);
}
