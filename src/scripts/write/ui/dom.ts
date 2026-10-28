// Tiny DOM helpers for the /write app shell (no framework).

type Kid = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; text?: string; on?: Record<string, (e: any) => void> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
    else if (k === 'hidden' || k === 'disabled' || k === 'checked' || k === 'readOnly' || k === 'value') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

let uid = 0;
export const id = (p = 'w') => `${p}-${++uid}`;

const SVG = 'http://www.w3.org/2000/svg';
const ICONS: Record<string, string> = {
  posts: 'M4 6h16M4 12h16M4 18h10',
  more: '',
  close: 'M6 6l12 12M18 6L6 18',
  ext: 'M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};
export function icon(name: keyof typeof ICONS | string, size = 18): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ico');
  if (name === 'more') {
    for (const cx of [6, 12, 18]) {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('cx', String(cx)); c.setAttribute('cy', '12'); c.setAttribute('r', '1.6');
      c.setAttribute('fill', 'currentColor');
      s.append(c);
    }
    return s;
  }
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONS[name] || '');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.append(p);
  return s;
}

/** Turn a file pick into a promise (no input left in the DOM). */
export function pickFile(accept = 'image/*'): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, hidden: true });
    let done = false;
    const finish = (f: File | null) => { if (done) return; done = true; inp.remove(); resolve(f); };
    inp.addEventListener('change', () => finish(inp.files?.[0] ?? null));
    inp.addEventListener('cancel', () => finish(null));
    document.body.append(inp);
    inp.click();
  });
}

export function download(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
