// Pixel size of an image under public/, read from its header (webp, png, gif, jpeg), cached.
// Used to give <img> width/height (no layout shift while images load) and gallery rows their
// proportions. Returns null when unknown (remote image, missing file, unreadable format).
import { openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const cache = new Map();
const PUBLIC = resolve(process.cwd(), 'public');

function head(file, n = 65536) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const len = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, len);
  } finally { closeSync(fd); }
}

export function parseDims(b) {
  if (b.length < 30) return null;
  // PNG
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  // GIF
  if (b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  // WebP
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    return null;
  }
  // JPEG: walk the markers to the frame header. Photos with EXIF orientation are skipped (their
  // stored size may be rotated); the editor's uploads never carry EXIF.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (m === 0xe1 && b.toString('ascii', i + 4, i + 8) === 'Exif') return null;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** Dimensions for a root-relative site src like /blog/x.webp, or null. */
export function imageDims(src) {
  if (typeof src !== 'string' || !src.startsWith('/') || src.startsWith('//')) return null;
  if (cache.has(src)) return cache.get(src);
  let out = null;
  try {
    const path = resolve(join(PUBLIC, decodeURIComponent(src.split(/[?#]/)[0])));
    if (path.startsWith(PUBLIC + sep)) {
      const d = parseDims(head(path));
      if (d && d.w > 0 && d.h > 0) out = d;
    }
  } catch { out = null; }
  cache.set(src, out);
  return out;
}
