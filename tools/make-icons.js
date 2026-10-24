#!/usr/bin/env node
/* PulseGrid — tools/make-icons.js
 *
 * Generates the PWA icons from scratch with a hand-rolled PNG encoder
 * (node:zlib only — the project stays dependency-free). Re-run after
 * changing the logo:  node tools/make-icons.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/* ---------- minimal PNG encoder (RGBA, 8-bit) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const zlib = require('node:zlib');
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- logo rendering ---------- */

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const DOTS = [
  { x: 0.30, c: [34, 211, 238] },   // cyan
  { x: 0.50, c: [129, 140, 248] },  // indigo
  { x: 0.70, c: [244, 63, 94] },    // rose
];
const BG_TOP = [26, 36, 54];
const BG_BOT = [11, 14, 20];

function drawIcon(S, maskable) {
  const px = Buffer.alloc(S * S * 4);
  const cy = S * 0.5;
  const r = S * (maskable ? 0.085 : 0.115);
  const cornerR = S * 0.22;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // rounded-square coverage (maskable icons fill the whole canvas)
      let cover = 1;
      if (!maskable) {
        const dx = Math.max(Math.abs(x - S / 2) - (S / 2 - cornerR), 0);
        const dy = Math.max(Math.abs(y - S / 2) - (S / 2 - cornerR), 0);
        cover = 1 - smooth(cornerR - 1.5, cornerR + 1.5, Math.hypot(dx, dy));
      }
      let col = mix(BG_TOP, BG_BOT, y / S);
      for (const d of DOTS) {
        const dist = Math.hypot(x - d.x * S, y - cy);
        const edge = 1 - smooth(r - 1.5, r + 1.5, dist);
        if (edge > 0) {
          col = mix(col, d.c, edge);
        } else {
          col = mix(col, d.c, Math.max(0, 1 - smooth(r, r * 2.1, dist)) * 0.22); // soft halo
        }
      }
      const i = (y * S + x) * 4;
      px[i] = Math.round(col[0]);
      px[i + 1] = Math.round(col[1]);
      px[i + 2] = Math.round(col[2]);
      px[i + 3] = Math.round(cover * 255);
    }
  }
  return encodePNG(S, S, px);
}

/* ---------- write ---------- */

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
];
for (const [name, size, maskable] of targets) {
  const buf = drawIcon(size, maskable);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`wrote icons/${name} (${size}x${size}, ${buf.length} bytes)`);
}
