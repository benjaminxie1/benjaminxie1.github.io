// The /write editor: wiring of editor, toolbar, saving, images and panels.

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { mountBanner } from '../banner';
import { BRANCH, RAW, POSTS_DIR, MEDIA_DIR, LOCAL_KEY, TOKEN_KEY, $, store, type Doc, today, blank, toDisplay, toSite, slugify, slugOf } from './lib';
import { token, gh, b64, unb64, getFile, putFile } from './github';
import { toMarkdown as mdOf, parseMarkdown } from './markdown';

let doc: Doc = blank();
let dirty = false; // changed since last commit

// ---------- elements ----------
const titleIn = $<HTMLTextAreaElement>('.title-in');
const dekIn = $<HTMLTextAreaElement>('.dek-in');
const dateIn = $<HTMLInputElement>('.date-in');
const draftTag = $('.draft-tag');
const statusEl = $('.status');
const primaryBtn = $<HTMLButtonElement>('[data-act="primary"]');
const secondaryBtn = $<HTMLButtonElement>('[data-act="secondary"]');
const banner = mountBanner($('.post-banner'), { seed: 'new-post' });

const grow = (t: HTMLTextAreaElement) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };

// ---------- editor ----------
const editor = new Editor({
  element: $('.editor'),
  extensions: [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      underline: false,
      code: false,
      codeBlock: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: null, target: null } },
    }),
    Image,
    Placeholder.configure({ placeholder: 'Start writing…' }),
  ],
  editorProps: {
    attributes: { class: 'body', spellcheck: 'true' },
    handlePaste: (_v, e) => takeImages(e.clipboardData?.files),
    handleDrop: (_v, e) => takeImages((e as DragEvent).dataTransfer?.files),
  },
  onUpdate: () => changed(),
  onSelectionUpdate: () => paintToolbar(),
  onTransaction: () => paintToolbar(),
});

function takeImages(files?: FileList | null) {
  const imgs = [...(files || [])].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return false;
  imgs.forEach((f) => insertImage(f));
  return true;
}

// ---------- toolbar ----------
const cmds: Record<string, () => void> = {
  bold: () => editor.chain().focus().toggleBold().run(),
  italic: () => editor.chain().focus().toggleItalic().run(),
  h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  quote: () => editor.chain().focus().toggleBlockquote().run(),
  ul: () => editor.chain().focus().toggleBulletList().run(),
  ol: () => editor.chain().focus().toggleOrderedList().run(),
  hr: () => editor.chain().focus().setHorizontalRule().run(),
  link: () => {
    const prev = editor.getAttributes('link').href || '';
    const url = window.prompt('Link to (leave empty to remove):', prev);
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|\/)/.test(url) ? url : 'https://' + url }).run();
  },
  image: () => $<HTMLInputElement>('.file-image').click(),
  cover: () => {
    if (doc.cover && window.confirm('Remove the cover image? (Cancel to pick a new one)')) {
      doc.cover = ''; banner.set({ cover: null }); changed(); paintToolbar(); return;
    }
    $<HTMLInputElement>('.file-cover').click();
  },
};
document.querySelectorAll<HTMLButtonElement>('.fmt button').forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection
  b.addEventListener('click', () => cmds[b.dataset.cmd!]());
});
function paintToolbar() {
  const on: Record<string, boolean> = {
    bold: editor.isActive('bold'), italic: editor.isActive('italic'),
    h2: editor.isActive('heading', { level: 2 }), h3: editor.isActive('heading', { level: 3 }),
    quote: editor.isActive('blockquote'), ul: editor.isActive('bulletList'), ol: editor.isActive('orderedList'),
    link: editor.isActive('link'), cover: !!doc.cover,
  };
  document.querySelectorAll<HTMLButtonElement>('.fmt button').forEach((b) => b.classList.toggle('on', !!on[b.dataset.cmd!]));
}
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(doc.published ? 'publish' : 'draft'); }
  if (mod && e.key.toLowerCase() === 'k' && editor.isFocused) { e.preventDefault(); cmds.link(); }
});

// ---------- status / buttons ----------
let statusTimer = 0;
function status(msg: string, html = false) {
  clearTimeout(statusTimer);
  if (html) statusEl.innerHTML = msg; else statusEl.textContent = msg;
}
function paintButtons() {
  primaryBtn.textContent = doc.published ? 'Update' : 'Publish';
  secondaryBtn.textContent = doc.published ? 'Unpublish' : 'Save draft';
  draftTag.hidden = doc.published;
}

// ---------- local autosave ----------
let saveTimer = 0;
function changed() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveLocal, 400);
}
function collect() {
  doc.title = titleIn.value;
  doc.description = dekIn.value;
  doc.date = dateIn.value || today();
  doc.html = editor.getHTML();
}
function saveLocal() {
  collect();
  const ok = store.set(LOCAL_KEY, JSON.stringify({ doc, dirty }));
  status(ok ? (dirty ? 'Saved on this device' : 'All changes saved') : 'Couldn’t autosave on this device');
}
function load(d: Doc, isDirty = false) {
  doc = d;
  dirty = isDirty;
  titleIn.value = d.title;
  dekIn.value = d.description;
  dateIn.value = d.date || today();
  editor.commands.setContent(d.html || '', { emitUpdate: false });
  grow(titleIn); grow(dekIn);
  banner.set({ seed: slugOf(d) || 'new-post', cover: d.cover ? toDisplay(d.cover) : null });
  paintButtons(); paintToolbar();
}
for (const el of [titleIn, dekIn]) el.addEventListener('input', () => { grow(el); changed(); });
titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dekIn.focus(); } });
dekIn.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  editor.view.focus(); // synchronous, so fast typing lands in the body
  editor.commands.setTextSelection(1);
});
dateIn.addEventListener('input', changed);
titleIn.addEventListener('change', () => { if (!doc.path) banner.set({ seed: slugify(titleIn.value) || 'new-post' }); });
window.addEventListener('resize', () => { grow(titleIn); grow(dekIn); });
window.addEventListener('beforeunload', (e) => { if (dirty && !store.get(LOCAL_KEY)) e.preventDefault(); });

function toMarkdown() {
  collect();
  return mdOf(doc);
}

function needToken() {
  if (token()) return false;
  openSettings('Add a GitHub key first, then hit save again.');
  return true;
}

let busy = false;
async function save(mode: 'draft' | 'publish') {
  if (busy || needToken()) return;
  collect();
  if (!doc.title.trim()) { status('Give it a title first'); titleIn.focus(); return; }
  busy = true;
  const was = { draft: doc.draft };
  try {
    status(mode === 'publish' ? 'Publishing…' : 'Saving…');
    if (!doc.path) {
      const base = slugify(doc.title) || 'post';
      let slug = base, n = 2;
      while (await getFile(`${POSTS_DIR}/${slug}.md`)) slug = `${base}-${n++}`;
      doc.path = `${POSTS_DIR}/${slug}.md`;
    } else if (!doc.sha) {
      doc.sha = (await getFile(doc.path))?.sha ?? null;
    }
    doc.draft = mode !== 'publish';
    const msg = `${doc.draft ? 'Draft' : doc.published ? 'Update' : 'Publish'}: ${doc.title.trim()}`;
    let out;
    try {
      out = await putFile(doc.path, b64(toMarkdown()), msg, doc.sha);
    } catch (err) {
      // file changed elsewhere (e.g. edited on GitHub): take the latest sha and write ours
      if (!/does not match|sha/i.test(String((err as Error).message))) throw err;
      doc.sha = (await getFile(doc.path))?.sha ?? null;
      out = await putFile(doc.path, b64(toMarkdown()), msg, doc.sha);
    }
    doc.sha = out.content.sha;
    doc.published = !doc.draft;
    dirty = false;
    saveLocal();
    paintButtons();
    const slug = slugOf(doc);
    const url = doc.draft ? `/blog/draft/${slug}/` : `/blog/${slug}/`;
    status(`${doc.draft ? (was.draft ? 'Draft saved' : 'Unpublished') : 'Published'} · live in ~2 min · <a href="${url}" target="_blank" rel="noopener">${doc.draft ? 'preview' : 'view'}</a>`, true);
  } catch (err) {
    doc.draft = was.draft;
    status('⚠ ' + (err as Error).message);
  } finally {
    busy = false;
  }
}
primaryBtn.addEventListener('click', () => save('publish'));
secondaryBtn.addEventListener('click', () => save('draft'));

// ---------- images ----------
async function shrink(file: File, max = 1800): Promise<{ blob: Blob; ext: string }> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { blob: file, ext: file.type === 'image/gif' ? 'gif' : 'svg' };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/webp', 0.86));
  return { blob, ext: 'webp' };
}
const blobB64 = (b: Blob) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
async function upload(file: File, label: string) {
  collect();
  const { blob, ext } = await shrink(file);
  const base = (slugOf(doc) || 'post') + '-' + label + '-' + Date.now().toString(36);
  const name = `${base}.${ext}`;
  await putFile(`${MEDIA_DIR}/${name}`, await blobB64(blob), `Image for ${doc.title.trim() || 'blog post'}`);
  return { site: `/blog/${name}`, preview: URL.createObjectURL(blob) };
}
async function insertImage(file: File) {
  if (needToken()) return;
  status('Uploading image…');
  try {
    const { site, preview } = await upload(file, 'img');
    editor.chain().focus().setImage({ src: preview, alt: '' }).run();
    // swap the instant local preview for the permanent GitHub copy once it's reachable
    const final = toDisplay(site);
    const probe = new window.Image();
    probe.onload = () => {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === preview) {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: final }));
        }
      });
      changed();
    };
    let tries = 0;
    const tryLoad = () => { probe.src = final + '?t=' + tries; };
    probe.onerror = () => { if (++tries < 20) setTimeout(tryLoad, 1500); };
    tryLoad();
    status('Image added');
  } catch (err) {
    status('⚠ ' + (err as Error).message);
  }
}
$<HTMLInputElement>('.file-image').addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  [...(t.files || [])].forEach(insertImage);
  t.value = '';
});
$<HTMLInputElement>('.file-cover').addEventListener('change', async (e) => {
  const t = e.target as HTMLInputElement;
  const f = t.files?.[0];
  t.value = '';
  if (!f || needToken()) return;
  status('Uploading cover…');
  try {
    const { site, preview } = await upload(f, 'cover');
    doc.cover = site;
    banner.set({ cover: preview });
    changed(); paintToolbar();
    status('Cover set');
  } catch (err) {
    status('⚠ ' + (err as Error).message);
  }
});

// ---------- posts panel ----------
const postsPanel = $<HTMLDialogElement>('.posts-panel');
const list = $('.post-list');
async function openPosts() {
  postsPanel.showModal();
  if (!token()) { list.innerHTML = '<li class="muted">Connect GitHub (⚙) to see your posts.</li>'; return; }
  list.innerHTML = '<li class="muted">Loading…</li>';
  try {
    const r = await gh(`/contents/${POSTS_DIR}?ref=${BRANCH}`);
    const items = r.status === 404 ? [] : ((await r.json()) as { name: string; path: string }[]).filter((f) => /\.mdx?$/.test(f.name));
    const docs = await Promise.all(items.map(async (f) => {
      const file = await getFile(f.path);
      return parseMarkdown(unb64(file.content), f.path, file.sha);
    }));
    docs.sort((a, b) => b.date.localeCompare(a.date));
    list.innerHTML = '';
    if (!docs.length) list.innerHTML = '<li class="muted">No posts yet.</li>';
    for (const d of docs) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'post-item';
      b.innerHTML = `<span class="pi-title"></span><span class="pi-meta"></span>`;
      b.querySelector('.pi-title')!.textContent = d.title || '(untitled)';
      b.querySelector('.pi-meta')!.textContent = `${d.draft ? 'Draft' : 'Published'} · ${d.date}`;
      b.addEventListener('click', () => {
        if (dirty && doc.path !== d.path && !window.confirm('You have unsaved changes on this post. Switch anyway? (They stay on this device only until you leave.)')) return;
        load(d);
        saveLocal();
        postsPanel.close();
        status(`Opened “${d.title}”`);
      });
      li.appendChild(b);
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '⚠ ' + (err as Error).message;
    list.appendChild(li);
  }
}
$('.new-post').addEventListener('click', () => {
  if (dirty && !window.confirm('Start a new post? Unsaved changes to the current one will be lost.')) return;
  load(blank());
  saveLocal();
  postsPanel.close();
  titleIn.focus();
});
$('[data-act="posts"]').addEventListener('click', openPosts);

// ---------- settings ----------
const settings = $<HTMLDialogElement>('.settings-panel');
const tokenIn = $<HTMLInputElement>('.token-in');
const tokenMsg = $('.token-msg');
function openSettings(msg = '') {
  tokenIn.value = token();
  tokenMsg.textContent = msg || (token() ? 'A key is saved in this browser.' : '');
  settings.showModal();
}
$('[data-act="settings"]').addEventListener('click', () => openSettings());
$('.save-token').addEventListener('click', async () => {
  const v = tokenIn.value.trim();
  if (!v) return;
  store.set(TOKEN_KEY, v);
  tokenMsg.textContent = 'Testing…';
  try {
    const r = await gh('');
    if (r.status === 404) throw new Error('Can’t see the repo: check repository access');
    const repo = await r.json();
    if (!repo.permissions?.push) throw new Error('Key can read but not write: set Contents to Read and write');
    tokenMsg.textContent = '✓ Connected. You can close this.';
  } catch (err) {
    tokenMsg.textContent = '⚠ ' + (err as Error).message;
  }
});
$('.forget-token').addEventListener('click', () => { store.del(TOKEN_KEY); tokenIn.value = ''; tokenMsg.textContent = 'Key removed from this browser.'; });
document.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', () => (b.closest('dialog') as HTMLDialogElement).close()));
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

// ---------- start ----------
const saved = store.get(LOCAL_KEY);
if (saved) {
  try { const s = JSON.parse(saved); load({ ...blank(), ...s.doc }, !!s.dirty); status(s.dirty ? 'Restored your unsaved draft' : ''); }
  catch { load(blank()); }
} else {
  load(blank());
}
if (!token()) status('Not connected yet: tap ⚙');
if (!titleIn.value) titleIn.focus();

