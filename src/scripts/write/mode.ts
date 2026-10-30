// Posts | Site switch in the /write top bar. The mode lives on <html data-mode> (set
// before first paint by an inline script in write.astro), in the URL hash (#site) and
// in localStorage, so /write reopens where you left off. Site mode loads lazily.
import { store } from './lib';

type Mode = 'posts' | 'site';
type SiteApp = { enter(): void; leave(): void };
const KEY = 'bx-write:mode';
const html = document.documentElement;
let site: Promise<SiteApp> | null = null;

function apply(mode: Mode) {
  html.dataset.mode = mode;
  store.set(KEY, mode);
  document.querySelectorAll<HTMLButtonElement>('.mode-sw [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  const want = mode === 'site' ? '#site' : '';
  if (location.hash !== want && (mode === 'site' || location.hash === '#site')) history.replaceState(history.state, '', location.pathname + location.search + want);
  if (mode === 'site') {
    site ||= import('./site/app').then((m) => m.startSite());
    site.then((s) => { if (html.dataset.mode === 'site') s.enter(); });
  } else {
    site?.then((s) => s.leave());
    document.title = document.title.replace(/^(• )?Site · Write$/, 'Write');
    window.dispatchEvent(new Event('bx-mode-posts'));
  }
}

document.querySelectorAll<HTMLButtonElement>('.mode-sw [data-mode]').forEach((b) =>
  b.addEventListener('click', () => { if (html.dataset.mode !== b.dataset.mode) apply(b.dataset.mode as Mode); }));
window.addEventListener('hashchange', () => apply(location.hash === '#site' ? 'site' : 'posts'));
apply(html.dataset.mode === 'site' ? 'site' : 'posts');
