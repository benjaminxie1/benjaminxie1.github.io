// Post header art: a field of small ink triangles on paper that dissolves into
// the page along a ragged edge. Seeded by the post slug so each post gets its
// own stable pattern; if a cover image is set, its tones drive the density.
// A few cells slowly flicker so it feels alive.

export function mountBanner(root: HTMLElement, opts: { seed: string; cover?: string }) {
  const canvas = root.querySelector('canvas')!;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { set() {} };

  let seed = 0;
  const setSeed = (s: string) => {
    let h = 2166136261;
    for (const ch of s || 'post') h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    seed = h >>> 0;
  };
  const hash = (x: number, y: number) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smooth(x - xi), fy = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#22211e';
  const accent = css.getPropertyValue('--tag').trim() || '#b5452f';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let tones: Float32Array | null = null;
  let cols = 0, rows = 0, cell = 12, dpr = 1, w = 0, hgt = 0;
  let coverImg: HTMLImageElement | null = null;
  let state = new Float32Array(0);

  function sampleCover() {
    tones = null;
    if (!coverImg || !coverImg.complete || !coverImg.naturalWidth || !cols) return;
    const off = document.createElement('canvas');
    off.width = cols; off.height = rows;
    const o = off.getContext('2d', { willReadFrequently: true })!;
    const ia = coverImg.naturalWidth / coverImg.naturalHeight, ba = cols / rows;
    let sw = coverImg.naturalWidth, sh = coverImg.naturalHeight, sx = 0, sy = 0;
    if (ia > ba) { sw = sh * ba; sx = (coverImg.naturalWidth - sw) / 2; }
    else { sh = sw / ba; sy = (coverImg.naturalHeight - sh) / 2; }
    o.drawImage(coverImg, sx, sy, sw, sh, 0, 0, cols, rows);
    const px = o.getImageData(0, 0, cols, rows).data;
    tones = new Float32Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
      tones[i] = 1 - (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    }
  }

  const density = (cx: number, cy: number) => {
    const y = cy / rows;
    const edge = 0.5 + 0.32 * (noise(cx * 0.045, 7.3) - 0.5) * 2 + 0.08 * (noise(cx * 0.2, 3.1) - 0.5);
    const fall = 1 - smooth(Math.min(1, Math.max(0, (y - (edge - 0.22)) / 0.3)));
    const base = tones ? 0.15 + 0.85 * tones[cy * cols + cx] : 0.5 + 0.5 * noise(cx * 0.12, cy * 0.12);
    return fall * base * 0.95;
  };

  function drawCell(cx: number, cy: number, r: number) {
    const c = ctx!;
    const x = cx * cell, y = cy * cell, s = cell;
    c.clearRect(x, y, s, s);
    if (r > density(cx, cy)) return;
    const pick = hash(cx * 7 + 1, cy * 13 + Math.floor(r * 1000));
    const isAccent = hash(cx + 911, cy + 577) < 0.012;
    c.fillStyle = c.strokeStyle = isAccent ? accent : ink;
    c.globalAlpha = isAccent ? 0.85 : 0.14 + 0.56 * hash(cx + 31, cy + 17) * (1 - (cy / rows) * 0.4);
    const g = Math.max(1, Math.round(dpr));
    const x0 = x + g, y0 = y + g, x1 = x + s - g, y1 = y + s - g;
    const tri = [
      [x0, y0, x1, y0, x0, y1],
      [x0, y0, x1, y0, x1, y1],
      [x1, y0, x1, y1, x0, y1],
      [x0, y0, x1, y1, x0, y1],
    ][Math.floor(pick * 4)];
    c.beginPath();
    c.moveTo(tri[0], tri[1]); c.lineTo(tri[2], tri[3]); c.lineTo(tri[4], tri[5]); c.closePath();
    if ((pick * 10) % 1 < 0.28) { c.lineWidth = Math.max(1, dpr * 0.9); c.stroke(); }
    else c.fill();
    c.globalAlpha = 1;
  }

  function reroll() {
    state = new Float32Array(cols * rows);
    for (let i = 0; i < state.length; i++) state[i] = hash(i % cols, Math.floor(i / cols) + 4099);
  }
  function draw() {
    ctx!.clearRect(0, 0, w, hgt);
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) drawCell(cx, cy, state[cy * cols + cx]);
  }
  function resize() {
    const r = root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cell = Math.round((r.width < 640 ? 10 : 13) * dpr);
    w = canvas.width = Math.round(r.width * dpr);
    hgt = canvas.height = Math.round(r.height * dpr);
    cols = Math.ceil(w / cell); rows = Math.ceil(hgt / cell);
    reroll();
    sampleCover();
    draw();
  }

  function setCover(src?: string) {
    if (!src) { coverImg = null; sampleCover(); draw(); return; }
    const img = new Image();
    img.decoding = 'async';
    if (/^https?:/.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
    img.addEventListener('load', () => { if (coverImg === img) { sampleCover(); draw(); } }, { once: true });
    coverImg = img;
    img.src = src;
  }

  setSeed(opts.seed);
  new ResizeObserver(resize).observe(root);
  setCover(opts.cover);

  if (!reduced) {
    let visible = true;
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(root);
    setInterval(() => {
      if (!visible || document.hidden || !cols) return;
      for (let n = 0; n < Math.max(3, (cols * rows) / 400); n++) {
        const cx = Math.floor(Math.random() * cols), cy = Math.floor(Math.random() * rows);
        state[cy * cols + cx] = Math.random();
        drawCell(cx, cy, state[cy * cols + cx]);
      }
    }, 180);
  }
  root.classList.add('live');

  return {
    /** Change the seed and/or cover (used by the live editor). */
    set(next: { seed?: string; cover?: string | null }) {
      if (next.seed !== undefined) { setSeed(next.seed); reroll(); }
      if (next.cover !== undefined) setCover(next.cover || undefined);
      else draw();
    },
  };
}
