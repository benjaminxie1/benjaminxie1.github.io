// Reading enhancements for published posts (src/pages/blog/[...slug].astro).
// Everything here is progressive: the post reads fine without JavaScript.
import { initLightbox } from './lightbox';
import { initCodeCopy } from './code-copy';
import { initFootnotes } from './footnotes';
import { initAnchors } from './anchors';
import { initToc } from './toc';
import { initLinks } from './links';

const body = document.querySelector<HTMLElement>('.post .body');
if (body) {
  for (const init of [initLinks, initAnchors, initCodeCopy, initLightbox, initFootnotes]) {
    try {
      init(body);
    } catch (e) {
      console.warn('[read]', e);
    }
  }
  try {
    initToc(document.querySelector<HTMLElement>('.read-toc'), body);
  } catch (e) {
    console.warn('[read]', e);
  }
}

// Print: closed toggles can't be opened by CSS, so open them for the printout.
let reopened: HTMLDetailsElement[] = [];
window.addEventListener('beforeprint', () => {
  reopened = [...document.querySelectorAll<HTMLDetailsElement>('.post .body details:not([open])')];
  reopened.forEach((d) => (d.open = true));
});
window.addEventListener('afterprint', () => {
  reopened.forEach((d) => (d.open = false));
  reopened = [];
});
