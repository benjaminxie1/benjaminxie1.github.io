// Image captions for blog posts: a paragraph holding only image(s) becomes block figure(s).
//   <p><img src alt title="cap"></p>  →  <figure><img src alt><figcaption>cap</figcaption></figure>
//   <p><img src alt></p>              →  <figure><img src alt></figure>
// This matches the /write editor's figure HTML, so the editor and the post page agree.
// Exported as a Sätteri hast plugin (Astro 7's default Markdown processor) and as a
// unified/rehype plugin (if the site ever switches to `unified()`).

const isWs = (n) => n.type === 'text' && !String(n.value).trim();
const isImg = (n) => n.type === 'element' && n.tagName === 'img';
const isBr = (n) => n.type === 'element' && n.tagName === 'br';

/** Figures for a <p> that only holds images (and whitespace / line breaks), else null. */
export function figuresFor(p) {
  const kids = (p.children || []).filter((k) => !isWs(k) && !isBr(k));
  if (!kids.length || !kids.every(isImg)) return null;
  return kids.map((img) => {
    const { title, ...rest } = img.properties || {};
    const children = [{ type: 'element', tagName: 'img', properties: { loading: 'lazy', decoding: 'async', ...rest }, children: [] }];
    const cap = typeof title === 'string' ? title.trim() : '';
    if (cap) children.push({ type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: cap }] });
    return { type: 'element', tagName: 'figure', properties: {}, children };
  });
}

/** Sätteri hast plugin: `satteri({ hastPlugins: [figurePlugin] })`. */
export const figurePlugin = {
  name: 'blog-figures',
  element: {
    filter: ['p'],
    visit(node, ctx) {
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
      walk(child);
      out.push(child);
    }
    node.children = out;
  };
  return (tree) => walk(tree);
}
export default rehypeFigure;
