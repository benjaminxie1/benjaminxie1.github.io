/**
 * Inline markdown for site text (see src/content/site/CONTRACT.md).
 *
 * Grammar (nothing else is markup):
 *   **bold**      opener followed by, closer preceded by, a non-space; non-empty
 *   *italic*      same rules
 *   [text](url)   url may contain balanced (parentheses); links don't nest
 *   \X            literal X, for X in \ * [ ] ( )   (a backslash before anything else is literal)
 * Any delimiter that doesn't complete is plain text.
 *
 * renderInline() escapes all text and attributes, and only emits <a href> for
 * http(s):, mailto: and site-relative "/..." URLs; other links render as their text.
 * inlineFromNode() is the inverse: it reads a rendered/edited element back into
 * the shortest markdown that renders to the same content (escaping only where needed).
 */

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'strong' | 'em'; c: InlineNode[] }
  | { t: 'link'; href: string; c: InlineNode[] };

const SPECIAL = '\\*[]()';
const URL_SPECIAL = '\\()';
const isWs = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

// ---------- URLs ----------

/** True for URLs the site will link to: http(s)://, mailto:, or site-relative /path (not //host). */
export function isSafeUrl(url: string): boolean {
  if (!url || /[\u0000-\u001f\u007f\s]/.test(url)) return false;
  return /^https?:\/\/[^/]/i.test(url) || /^mailto:[^/]/i.test(url) || /^\/(?![/\\])/.test(url);
}

// ---------- HTML escaping ----------

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------- parse ----------

type Ctx = 'top' | 'strong' | 'em' | 'link';
type Res = { nodes: InlineNode[]; end: number } | null;

export function parseInline(s: string): InlineNode[] {
  const n = s.length;
  const memo = new Map<string, Res>();

  function pushText(out: InlineNode[], v: string) {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  }

  function mark(i: number, type: 'strong' | 'em', inLink: boolean): { node: InlineNode; end: number } | null {
    const len = type === 'strong' ? 2 : 1;
    if (isWs(s[i + len])) return null;
    const r = seq(i + len, type, inLink);
    if (!r || r.nodes.length === 0) return null;
    return { node: { t: type, c: r.nodes }, end: r.end };
  }

  function url(j: number): { href: string; end: number } | null {
    let depth = 0;
    let href = '';
    while (j < n) {
      const c = s[j];
      if (c === '\\' && j + 1 < n && URL_SPECIAL.includes(s[j + 1])) {
        href += s[j + 1];
        j += 2;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) return { href, end: j + 1 };
        depth--;
      }
      href += c;
      j++;
    }
    return null;
  }

  function seq(start: number, ctx: Ctx, inLink: boolean): Res {
    const key = `${start}|${ctx}|${inLink ? 1 : 0}`;
    if (memo.has(key)) return memo.get(key)!;
    memo.set(key, null); // guards against re-entry at the same state
    const out: InlineNode[] = [];
    let i = start;
    let res: Res = null;
    loop: while (i < n) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < n && SPECIAL.includes(s[i + 1])) {
        pushText(out, s[i + 1]);
        i += 2;
        continue;
      }
      if (ch === ']' && inLink) {
        if (ctx === 'link') res = { nodes: out, end: i + 1 };
        break loop; // a mark can't run past the end of its link
      }
      if (ch === '*') {
        const dbl = s[i + 1] === '*';
        if (ctx === 'strong' && dbl && !isWs(s[i - 1])) {
          res = { nodes: out, end: i + 2 };
          break loop;
        }
        if (ctx === 'em') {
          if (dbl) {
            const m = mark(i, 'strong', inLink);
            if (m) {
              out.push(m.node);
              i = m.end;
              continue;
            }
          }
          if (!isWs(s[i - 1])) {
            res = { nodes: out, end: i + 1 };
            break loop;
          }
          pushText(out, '*');
          i++;
          continue;
        }
        if (dbl && ctx !== 'strong') {
          const m = mark(i, 'strong', inLink);
          if (m) {
            out.push(m.node);
            i = m.end;
            continue;
          }
        }
        const m = mark(i, 'em', inLink);
        if (m) {
          out.push(m.node);
          i = m.end;
          continue;
        }
        pushText(out, '*');
        i++;
        continue;
      }
      if (ch === '[' && !inLink) {
        const r = seq(i + 1, 'link', true);
        if (r && r.nodes.length && s[r.end] === '(') {
          const u = url(r.end + 1);
          if (u) {
            out.push({ t: 'link', href: u.href, c: r.nodes });
            i = u.end;
            continue;
          }
        }
      }
      pushText(out, ch);
      i++;
    }
    if (!res && i >= n && ctx === 'top') res = { nodes: out, end: n };
    memo.set(key, res);
    return res;
  }

  return seq(0, 'top', false)!.nodes;
}

// ---------- render ----------

function renderNodes(nodes: InlineNode[]): string {
  let h = '';
  for (const node of nodes) {
    if (node.t === 'text') h += escHtml(node.v);
    else if (node.t === 'strong') h += `<strong>${renderNodes(node.c)}</strong>`;
    else if (node.t === 'em') h += `<em>${renderNodes(node.c)}</em>`;
    else if (isSafeUrl(node.href)) h += `<a href="${escAttr(node.href)}">${renderNodes(node.c)}</a>`;
    else h += renderNodes(node.c);
  }
  return h;
}

/** Inline markdown → safe HTML (<strong>, <em>, <a href>; everything else escaped). */
export function renderInline(md: string): string {
  return renderNodes(parseInline(md ?? ''));
}

// ---------- normalize (render-invariant canonical tree) ----------

/**
 * Canonical form of a tree, preserving what it renders to: unsafe links become their
 * content, same-kind marks directly inside each other are flattened, links inside links
 * become their content, leading/trailing whitespace moves outside bold/italic, empty
 * marks/links are dropped and adjacent text merged.
 */
export function normalizeInline(nodes: InlineNode[], parent: InlineNode['t'] | null = null, inLink = false): InlineNode[] {
  const out: InlineNode[] = [];
  const text = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  };
  for (const node of nodes) {
    if (node.t === 'text') {
      text(node.v);
      continue;
    }
    const flatten =
      (node.t === 'link' && (inLink || !isSafeUrl(node.href))) || (node.t !== 'link' && node.t === parent);
    if (flatten) {
      for (const c of normalizeInline(node.c, parent, inLink)) c.t === 'text' ? text(c.v) : out.push(c);
      continue;
    }
    const c = normalizeInline(node.c, node.t, inLink || node.t === 'link');
    if (node.t === 'link') {
      if (c.length) out.push({ t: 'link', href: node.href, c });
      continue;
    }
    // move edge whitespace outside bold/italic
    let lead = '';
    let trail = '';
    const first = c[0];
    if (first && first.t === 'text') {
      const m = /^\s+/.exec(first.v);
      if (m) {
        lead = m[0];
        first.v = first.v.slice(lead.length);
        if (!first.v) c.shift();
      }
    }
    const last = c[c.length - 1];
    if (last && last.t === 'text') {
      const m = /\s+$/.exec(last.v);
      if (m) {
        trail = m[0];
        last.v = last.v.slice(0, -trail.length);
        if (!last.v) c.pop();
      }
    }
    text(lead);
    if (c.length === 1 && node.t === 'em' && c[0].t === 'strong') {
      // *(**x**)* and **(*x*)** look the same, but "***x***" only parses as the latter
      for (const s of normalizeInline([{ t: 'strong', c: [{ t: 'em', c: c[0].c }] }], parent, inLink))
        s.t === 'text' ? text(s.v) : out.push(s);
    } else if (c.length) out.push({ t: node.t, c });
    text(trail);
  }
  return out;
}

const sameTree = (a: InlineNode[], b: InlineNode[]): boolean =>
  a.length === b.length &&
  a.every((x, k) => {
    const y = b[k];
    if (x.t !== y.t) return false;
    if (x.t === 'text') return x.v === (y as typeof x).v;
    if (x.t === 'link' && x.href !== (y as typeof x).href) return false;
    return sameTree(x.c, (y as Exclude<InlineNode, { t: 'text' }>).c);
  });

// ---------- serialize ----------

type Piece = { s: string; esc?: string };

function serializeUrl(href: string): string {
  const ok = (cand: string) => {
    const t = parseInline(`[x](${cand})`);
    return t.length === 1 && t[0].t === 'link' && t[0].href === href;
  };
  if (ok(href)) return href;
  return href.replace(/[\\()]/g, '\\$&');
}

function pieces(nodes: InlineNode[], out: Piece[]) {
  for (const node of nodes) {
    if (node.t === 'text') {
      for (const ch of node.v) {
        if ('\\*[]'.includes(ch)) out.push({ s: '\\' + ch, esc: ch });
        else out.push({ s: ch });
      }
    } else if (node.t === 'link') {
      out.push({ s: '[' });
      pieces(node.c, out);
      out.push({ s: `](${serializeUrl(node.href)})` });
    } else {
      const d = node.t === 'strong' ? '**' : '*';
      out.push({ s: d });
      pieces(node.c, out);
      out.push({ s: d });
    }
  }
}

/** Tree → the shortest-escaped inline markdown that parses back to the same (normalized) tree. */
export function serializeInline(tree: InlineNode[]): string {
  const target = normalizeInline(tree);
  const matches = (md: string) => sameTree(normalizeInline(parseInline(md)), target);
  const ps: Piece[] = [];
  pieces(target, ps);
  const join = () => ps.map((p) => p.s).join('');
  // 1) no escapes at all (the common case: text as typed)
  const saved = ps.map((p) => p.s);
  for (const p of ps) if (p.esc) p.s = p.esc;
  if (matches(join())) return join();
  ps.forEach((p, k) => (p.s = saved[k]));
  // 2) fully escaped, then drop each escape that isn't needed, left to right
  for (const p of ps) {
    if (!p.esc) continue;
    const prev = p.s;
    p.s = p.esc;
    if (!matches(join())) p.s = prev;
  }
  return join();
}

// ---------- DOM → markdown ----------

/** Reads an element's rendered/edited content as a tree (no DOM library needed beyond the node API). */
export function treeFromNode(el: Node): InlineNode[] {
  const out: InlineNode[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === 3 /* text */) {
      out.push({ t: 'text', v: (child.nodeValue ?? '').replace(/\r\n|\r|\n/g, ' ') });
    } else if (child.nodeType === 1 /* element */) {
      const e = child as Element;
      const tag = e.tagName.toUpperCase();
      if (tag === 'BR') out.push({ t: 'text', v: ' ' });
      else if (tag === 'STRONG' || tag === 'B') out.push({ t: 'strong', c: treeFromNode(e) });
      else if (tag === 'EM' || tag === 'I') out.push({ t: 'em', c: treeFromNode(e) });
      else if (tag === 'A' && e.hasAttribute('href')) out.push({ t: 'link', href: e.getAttribute('href')!, c: treeFromNode(e) });
      else out.push(...treeFromNode(e));
    }
  });
  return out;
}

/** Element → inline markdown. inlineFromNode(el) after el.innerHTML = renderInline(x) gives back x. */
export function inlineFromNode(el: Element): string {
  return serializeInline(treeFromNode(el));
}
