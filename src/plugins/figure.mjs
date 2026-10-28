// Image captions for blog posts: a paragraph holding only image(s) becomes block figure(s).
//   <p><img src alt title="cap"></p>  →  <figure><img src alt><figcaption>cap</figcaption></figure>
//   <p><img src alt></p>              →  <figure><img src alt></figure>
// Layout rides on a fragment of the src (stripped from the page), see src/scripts/write/markdown-images.ts:
//   ![a](x.webp#small|#wide|#full "cap")  →  <figure class="size-small|size-wide|size-full">
//   2+ images in one paragraph, all #row (or #row-wide / #row-full), optional trailing *caption* →
//   <div class="gallery [size-wide|size-full]"><figure style="--r:1.5">…</figure>…<p class="gallery-caption">…</p></div>
// Local images get width/height from the file (no layout shift; gallery rows share one height).
// This matches the /write editor's figure HTML, so the editor and the post page agree.
// Exported as a Sätteri hast plugin (Astro 7's default Markdown processor) and as a
// unified/rehype plugin (if the site ever switches to `unified()`).
import { imageDims } from './image-dims.mjs';

const isWs = (n) => n.type === 'text' && !String(n.value).trim();
const isImg = (n) => n.type === 'element' && n.tagName === 'img';
const isBr = (n) => n.type === 'element' && n.tagName === 'br';
const isEm = (n) => n.type === 'element' && n.tagName === 'em';
const FRAG = /#(small|wide|full|row(?:-(wide|full))?)$/;

/** { src without the layout fragment, size, row } for an image src. */
export function layoutOf(src) {
  const s = typeof src === 'string' ? src : '';
  const m = s.match(FRAG);
  if (!m) return { src: s, size: 'normal', row: null };
  const clean = s.slice(0, m.index);
  return m[1].startsWith('row') ? { src: clean, size: 'normal', row: m[2] || 'normal' } : { src: clean, size: m[1], row: null };
}
const textOf = (n) => (n.type === 'text' ? String(n.value) : (n.children || []).map(textOf).join(''));

function figure(img, { inRow = false } = {}) {
  const { title, src: raw, ...rest } = img.properties || {};
  const { src, size } = layoutOf(raw);
  const props = { loading: 'lazy', decoding: 'async', src, ...rest };
  const dims = imageDims(src);
  if (dims && props.width == null && props.height == null) { props.width = dims.w; props.height = dims.h; }
  const children = [{ type: 'element', tagName: 'img', properties: props, children: [] }];
  const cap = typeof title === 'string' ? title.trim() : '';
  if (cap) children.push({ type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: cap }] });
  const fp = {};
  if (inRow) { if (dims) fp.style = `--r:${(dims.w / dims.h).toFixed(4)}`; }
  else if (size !== 'normal') fp.className = [`size-${size}`];
  return { type: 'element', tagName: 'figure', properties: fp, children };
}

/** Figures (or one gallery) for a <p> that only holds images (and whitespace / line breaks), else null. */
export function figuresFor(p) {
  const kids = (p.children || []).filter((k) => !isWs(k) && !isBr(k));
  let cap = null;
  if (kids.length > 2 && isEm(kids[kids.length - 1]) && kids.slice(0, -1).every(isImg)) cap = kids.pop();
  if (!kids.length || !kids.every(isImg)) return null;
  const rows = kids.map((k) => layoutOf(k.properties?.src).row);
  if (kids.length >= 2 && rows.every(Boolean)) {
    const children = kids.map((img) => figure(img, { inRow: true }));
    const capText = cap ? textOf(cap).trim() : '';
    if (capText) children.push({ type: 'element', tagName: 'p', properties: { className: ['gallery-caption'] }, children: [{ type: 'text', value: capText }] });
    const className = ['gallery', ...(rows[0] !== 'normal' ? [`size-${rows[0]}`] : [])];
    return [{ type: 'element', tagName: 'div', properties: { className, role: 'group' }, children }];
  }
  if (cap) return null; // images + italic line, but not a row: leave the paragraph alone
  return kids.map((img) => figure(img));
}

/** Images inside running text (unified path): drop a layout fragment from the src. */
function cleanInline(node) {
  for (const k of node.children || []) {
    if (isImg(k) && k.properties) k.properties.src = layoutOf(k.properties.src).src;
    else if (k.children) cleanInline(k);
  }
}

/** Sätteri hast plugin: `satteri({ hastPlugins: [figurePlugin] })`. */
export const figurePlugin = {
  name: 'blog-figures',
  element: {
    filter: ['p', 'img'],
    visit(node, ctx) {
      if (node.tagName === 'img') {
        // an image inside running text: drop a layout fragment from the src (it means nothing there)
        const src = node.properties?.src;
        const clean = layoutOf(src).src;
        if (typeof src === 'string' && clean !== src) ctx.setProperty(node, 'src', clean);
        return;
      }
      const figs = figuresFor(node);
      if (figs) ctx.replaceNode(node, figs);
    },
  },
};

/** unified/rehype plugin: `unified({ rehypePlugins: [rehypeFigure] })`. */
export function rehypeFigure() {
  const walk = (node) => {
    if (!node.children) return;
    const out = [];
    for (const child of node.children) {
      const figs = child.type === 'element' && child.tagName === 'p' ? figuresFor(child) : null;
      if (figs) { out.push(...figs); continue; }
      if (child.type === 'element' && child.tagName === 'p') cleanInline(child);
      walk(child);
      out.push(child);
    }
    node.children = out;
  };
  return (tree) => walk(tree);
}
export default rehypeFigure;
