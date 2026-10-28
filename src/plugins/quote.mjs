// Quote sources for blog posts: a blockquote whose last paragraph (not its only one) starts with
// an em dash gets that paragraph marked as the source line.
//   > Ship the demo.\n>\n> — Paul Graham   →   <blockquote><p>Ship the demo.</p><p class="quote-source">— Paul Graham</p></blockquote>
// The /write editor shows the same class as a decoration (editor/blocks.ts), so both look alike.

const isEl = (n, tag) => n && n.type === 'element' && (!tag || n.tagName === tag);
const text = (n) => (n.type === 'text' ? n.value : (n.children || []).map(text).join(''));

/** The source paragraph of a blockquote hast node, or null. */
export function quoteSource(quote) {
  const els = (quote.children || []).filter((c) => isEl(c));
  const last = els[els.length - 1];
  if (els.length < 2 || !isEl(last, 'p')) return null;
  return /^\s*—/.test(text(last)) ? last : null;
}

/** Sätteri hast plugin: `satteri({ hastPlugins: [quotePlugin] })`. */
export const quotePlugin = {
  name: 'blog-quote-source',
  element: {
    filter: ['blockquote'],
    visit(node, ctx) {
      const p = quoteSource(node);
      if (p) ctx.setProperty(p, 'className', ['quote-source']);
    },
  },
};

/** unified/rehype plugin. */
export function rehypeQuote() {
  const walk = (node) => {
    if (isEl(node, 'blockquote')) {
      const p = quoteSource(node);
      if (p) p.properties = { ...(p.properties || {}), className: ['quote-source'] };
    }
    (node.children || []).forEach(walk);
  };
  return (tree) => walk(tree);
}
export default rehypeQuote;
