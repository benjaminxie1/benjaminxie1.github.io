// A calm crop dialog: aspect presets, free drag handles, rotate 90°. Resolves with a NEW image File
// (the caller uploads it like any other image), or null if cancelled / nothing changed.
import { h, icons } from './ui';
import { imgIcons } from './images';

type Rect = { x: number; y: number; w: number; h: number }; // normalized to the (rotated) image, 0..1
type Bmp = { img: CanvasImageSource; w: number; h: number; close(): void };

async function decode(blob: Blob): Promise<Bmp> {
  try {
    const b = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    return { img: b, w: b.width, h: b.height, close: () => b.close() };
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const el = new Image();
      el.src = url;
      await el.decode();
      return { img: el, w: el.naturalWidth, h: el.naturalHeight, close: () => {} };
    } finally { URL.revokeObjectURL(url); }
  }
}

const PRESETS: Array<{ id: string; label: string; ratio: number | 'orig' | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'orig', label: 'Original', ratio: 'orig' },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Draw the source rotated by rot×90° clockwise, scaled by k, shifted by (-ox,-oy) in rotated pixels. */
function paint(ctx: CanvasRenderingContext2D, src: Bmp, rot: number, k: number, ox = 0, oy = 0) {
  const W = rot % 2 ? src.h : src.w, H = rot % 2 ? src.w : src.h;
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-ox, -oy);
  if (rot === 1) { ctx.translate(W, 0); ctx.rotate(Math.PI / 2); }
  else if (rot === 2) { ctx.translate(W, H); ctx.rotate(Math.PI); }
  else if (rot === 3) { ctx.translate(0, H); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(src.img, 0, 0, src.w, src.h);
  ctx.restore();
}

export async function openCrop(blob: Blob, opts: { name?: string; alt?: string } = {}): Promise<File | null> {
  let src: Bmp;
  try { src = await decode(blob); } catch { return null; }

  let rot = 0;
  let rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  let preset = PRESETS[0];
  const dims = () => ({ W: rot % 2 ? src.h : src.w, H: rot % 2 ? src.w : src.h });
  const ratioOf = (p = preset) => (p.ratio === 'orig' ? dims().W / dims().H : p.ratio);

  // ---------- DOM ----------
  const canvas = h('canvas', { class: 'ed-crop-canvas', 'aria-hidden': 'true' });
  const handles = HANDLES.map((d) => h('span', { class: `ed-crop-h ed-crop-h-${d}`, 'data-h': d }));
  const box = h('div', { class: 'ed-crop-box', tabindex: '0', role: 'group', 'aria-label': 'Crop area. Arrow keys move it; Shift moves faster.', 'data-h': 'move' },
    h('span', { class: 'ed-crop-grid', 'aria-hidden': 'true' }), ...handles);
  const frame = h('div', { class: 'ed-crop-frame' }, canvas, box);
  const stage = h('div', { class: 'ed-crop-stage' }, frame);
  const size = h('span', { class: 'ed-crop-dims', 'aria-live': 'polite' });
  const chips = PRESETS.map((p) => {
    const b = h('button', { type: 'button', class: 'ed-crop-chip', role: 'radio', 'aria-checked': String(p === preset), 'data-id': p.id }, p.label);
    b.addEventListener('click', () => choose(p));
    return b;
  });
  const rotateBtn = h('button', { type: 'button', class: 'ed-btn ed-text-btn ed-crop-rotate', 'aria-label': 'Rotate 90° clockwise' }, h('span', { html: imgIcons.rotate }), 'Rotate');
  const resetBtn = h('button', { type: 'button', class: 'ed-btn ed-text-btn' }, 'Reset');
  const cancel = h('button', { type: 'button', class: 'ed-btn ed-text-btn' }, 'Cancel');
  const apply = h('button', { type: 'button', class: 'ed-btn ed-text-btn ed-primary ed-crop-apply' }, 'Crop image');
  const close = h('button', { type: 'button', class: 'ed-btn ed-icon-only ed-crop-x', 'aria-label': 'Close', html: icons.close });
  const dlg = h('dialog', { class: 'ed-crop', 'aria-label': 'Crop image' },
    h('div', { class: 'ed-crop-head' }, h('span', { class: 'ed-crop-title' }, 'Crop'), size, close),
    stage,
    h('div', { class: 'ed-crop-tools' },
      h('div', { class: 'ed-crop-chips', role: 'radiogroup', 'aria-label': 'Shape' }, ...chips),
      h('div', { class: 'ed-crop-acts' }, rotateBtn, resetBtn)),
    h('div', { class: 'ed-crop-foot' },
      h('span', { class: 'ed-crop-note' }, 'Saved as a new image; the original is kept.'),
      h('span', { class: 'ed-crop-btns' }, cancel, apply)));
  document.body.append(dlg);

  // ---------- layout ----------
  let dispW = 1, dispH = 1;
  const layout = () => {
    const { W, H } = dims();
    const maxW = Math.max(160, Math.min(820, window.innerWidth - (window.innerWidth < 640 ? 32 : 96)));
    const maxH = Math.max(160, Math.min(560, window.innerHeight - 250));
    const k = Math.min(maxW / W, maxH / H, 1);
    dispW = Math.max(1, Math.round(W * k)); dispH = Math.max(1, Math.round(H * k));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(dispW * dpr); canvas.height = Math.round(dispH * dpr);
    frame.style.width = dispW + 'px'; frame.style.height = dispH + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paint(ctx, src, rot, (dispW * dpr) / W);
    draw();
  };
  const changed = () => rot !== 0 || rect.x > 0.002 || rect.y > 0.002 || rect.w < 0.996 || rect.h < 0.996;
  const outPx = () => { const { W, H } = dims(); return { sx: Math.round(rect.x * W), sy: Math.round(rect.y * H), sw: Math.max(1, Math.round(rect.w * W)), sh: Math.max(1, Math.round(rect.h * H)) }; };
  const draw = () => {
    Object.assign(box.style, { left: rect.x * dispW + 'px', top: rect.y * dispH + 'px', width: rect.w * dispW + 'px', height: rect.h * dispH + 'px' });
    const { sw, sh } = outPx();
    size.textContent = `${sw} × ${sh}`;
    box.classList.toggle('is-locked', ratioOf() != null);
    for (const c of chips) c.setAttribute('aria-checked', String(c.dataset.id === preset.id));
    apply.disabled = !changed();
  };

  /** Largest rect of pixel aspect `a`, centered on the current crop's center. */
  const fit = (a: number) => {
    const { W, H } = dims();
    const k = (a * H) / W; // normalized w/h
    let w = 1, hh = 1;
    if (k <= 1) w = k; else hh = 1 / k;
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    rect = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - hh / 2, 0, 1 - hh), w, h: hh };
  };
  function choose(p: typeof PRESETS[number]) {
    preset = p;
    const a = ratioOf();
    if (p.ratio === 'orig') rect = { x: 0, y: 0, w: 1, h: 1 };
    else if (a != null) fit(a);
    draw();
  }
  rotateBtn.addEventListener('click', () => {
    rot = (rot + 1) % 4;
    rect = { x: 1 - (rect.y + rect.h), y: rect.x, w: rect.h, h: rect.w }; // the crop turns with the image
    if (preset.ratio === 'orig') rect = { x: 0, y: 0, w: 1, h: 1 };
    else if (typeof preset.ratio === 'number') fit(preset.ratio);
    layout();
  });
  resetBtn.addEventListener('click', () => { rot = 0; preset = PRESETS[0]; rect = { x: 0, y: 0, w: 1, h: 1 }; layout(); });

  // ---------- dragging ----------
  let drag: { h: string; px: number; py: number; r0: Rect } | null = null;
  const minW = () => Math.max(0.04, 28 / dispW), minH = () => Math.max(0.04, 28 / dispH);
  frame.addEventListener('pointerdown', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
    if (!t || e.button > 0) return;
    e.preventDefault();
    box.focus({ preventScroll: true });
    drag = { h: t.dataset.h!, px: e.clientX, py: e.clientY, r0: { ...rect } };
    frame.setPointerCapture(e.pointerId);
    frame.classList.add('is-dragging');
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.px) / dispW, dy = (e.clientY - drag.py) / dispH;
    const r0 = drag.r0, hd = drag.h;
    if (hd === 'move') {
      rect = { ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) };
      return draw();
    }
    const a = ratioOf();
    const east = hd.includes('e'), west = hd.includes('w'), south = hd.includes('s'), north = hd.includes('n');
    if (a == null) {
      let { x, y, w, h: hh } = r0;
      if (east) w = clamp(r0.w + dx, minW(), 1 - r0.x);
      if (west) { x = clamp(r0.x + dx, 0, r0.x + r0.w - minW()); w = r0.x + r0.w - x; }
      if (south) hh = clamp(r0.h + dy, minH(), 1 - r0.y);
      if (north) { y = clamp(r0.y + dy, 0, r0.y + r0.h - minH()); hh = r0.y + r0.h - y; }
      rect = { x, y, w, h: hh };
      return draw();
    }
    // locked aspect: corners only; the opposite corner stays put
    const { W, H } = dims();
    const k = (a * H) / W;
    const ax = west ? r0.x + r0.w : r0.x, ay = north ? r0.y + r0.h : r0.y;
    const gw = east ? dx : -dx, gh = (south ? dy : -dy) * k; // growth in width units, per axis
    const wantW = r0.w + (Math.abs(gw) >= Math.abs(gh) ? gw : gh); // follow the axis moved most
    const availW = east ? 1 - ax : ax, availH = south ? 1 - ay : ay;
    const w = clamp(wantW, Math.max(minW(), minH() * k), Math.min(availW, availH * k));
    const hh = w / k;
    rect = { x: east ? ax : ax - w, y: south ? ay : ay - hh, w, h: hh };
    draw();
  });
  const end = () => { drag = null; frame.classList.remove('is-dragging'); };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  box.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) {
      e.preventDefault();
      rect = { ...rect, x: clamp(rect.x + mv[e.key][0], 0, 1 - rect.w), y: clamp(rect.y + mv[e.key][1], 0, 1 - rect.h) };
      draw();
    } else if (e.key === 'Enter' && !apply.disabled) { e.preventDefault(); apply.click(); }
  });

  // ---------- result ----------
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  return new Promise<File | null>((resolve) => {
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('resize', onResize);
      if (dlg.open) dlg.close();
      dlg.remove();
      src.close();
      resolve(f);
    };
    cancel.addEventListener('click', () => finish(null));
    close.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); }); // backdrop
    apply.addEventListener('click', async () => {
      if (!changed()) return finish(null);
      apply.disabled = true;
      apply.textContent = 'Cropping…';
      const { sx, sy, sw, sh } = outPx();
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      paint(ctx, src, rot, 1, sx, sy);
      // near-lossless intermediate; uploadImage re-encodes (≤2000px webp) like any other upload
      const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.95));
      if (!out) { apply.textContent = 'Crop image'; apply.disabled = false; return; }
      const ext = out.type === 'image/webp' ? 'webp' : 'png';
      finish(new File([out], `${(opts.name || 'image').slice(0, 60)}.${ext}`, { type: out.type || 'image/png' }));
    });
    dlg.showModal();
    layout();
    box.focus({ preventScroll: true });
  });
}
