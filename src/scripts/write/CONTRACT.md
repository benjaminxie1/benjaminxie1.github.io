# /write editor: module contract

Three workstreams build in parallel. Each owns specific files and must not edit
files owned by another. Interfaces below are fixed; if you need to change one,
keep it backward compatible (add optional fields only).

## Document model (lib.ts — owned by DATA)

```ts
export type Doc = {
  path: string | null;   // e.g. 'src/content/blog/my-post.md' once it exists in the repo
  sha: string | null;    // blob sha of the repo copy this doc is based on
  title: string;
  description: string;
  date: string;          // 'YYYY-MM-DD'
  cover: string;         // site path '/blog/x.webp' or ''
  draft: boolean;        // draft flag of the repo copy (missing `draft:` in a file means published)
  published: boolean;    // repo copy is live
  html: string;          // editor HTML (see "Editor HTML" below)
  slug?: string;         // desired slug for a not-yet-saved post (editable until first publish)
  extra?: Record<string, unknown>; // unknown frontmatter keys, preserved verbatim on save
};
```
Also exported: OWNER, REPO, BRANCH, POSTS_DIR, MEDIA_DIR, RAW, `$`, `store`, `today`, `blank`,
`toDisplay(src)` (site path → URL that loads right now), `slugify`, `slugOf(doc)`.

## Editor HTML (shared by EDITOR and DATA)

- Paragraphs, h2, h3, blockquote, ul/ol/li, hr, strong, em, s (strike), code, a[href],
  `pre > code.language-xxx` (code blocks).
- Images are always block figures, with **site paths** in `src` (never blob: or raw URLs):
  `<figure><img src="/blog/x.webp" alt="alt text"><figcaption>caption</figcaption></figure>`
  (figcaption omitted when empty). Markdown form: `![alt](/blog/x.webp "caption")`.
  The EDITOR shows a preview/raw URL via a NodeView; `getHTML()` must still output the site path.
- Markdown ↔ HTML conversion (DATA, markdown.ts) must round-trip all of the above.

## DATA (owns lib.ts, github.ts, markdown.ts, local.ts, site rendering: src/pages/blog/**, src/styles/post.css, astro.config.mjs, src/content.config.ts, any new rehype/remark plugin)

github.ts
```ts
export class ConflictError extends Error { remote: Doc | null }   // repo copy changed since doc.sha
export const token: () => string;
export function setToken(t: string): void;
export function clearToken(): void;
export function testToken(): Promise<{ ok: true } | { ok: false; message: string }>; // must prove WRITE access
export function listPosts(): Promise<Array<{ path: string; sha: string; title: string; date: string; draft: boolean; description: string }>>;
export function loadPost(path: string): Promise<Doc>;
export function savePost(doc: Doc, opts: { draft: boolean; force?: boolean }): Promise<Doc>; // returns updated doc (path, sha, draft, published). throws ConflictError unless force
export function deletePost(doc: Doc): Promise<void>;
export function uploadImage(file: File, baseName: string): Promise<{ src: string; preview: string }>; // src = '/blog/…'; preview = blob URL usable immediately
export function postHistory(path: string): Promise<Array<{ commit: string; date: string; message: string }>>;
export function loadPostAt(path: string, commit: string): Promise<Doc>;
export function deployStatus(afterIso: string): Promise<'pending' | 'running' | 'live' | 'failed' | 'unknown'>; // latest Pages deploy run started after this time
export function isSlugTaken(slug: string): Promise<boolean>;
```
All repo writes go through one serialized queue with retry/backoff on 409/5xx.
Error messages are human (offline, rate-limited, key expired, no write access…).

local.ts (per-post local drafts in localStorage; every call try/catch-safe)
```ts
export type LocalEntry = { doc: Doc; dirty: boolean; savedAt: number };
export function saveLocal(doc: Doc, dirty: boolean): boolean;
export function loadLocal(key: string): LocalEntry | null;   // key = doc.path ?? 'new:<id>'
export function keyOf(doc: Doc): string;
export function listLocal(): Array<{ key: string } & LocalEntry>;
export function clearLocal(key: string): void;
export function lastOpened(): string | null; export function setLastOpened(key: string): void;
```

## EDITOR (owns src/scripts/write/editor.ts, src/scripts/write/editor/**, src/styles/write-editor.css)

```ts
export type EditorHandle = {
  editor: import('@tiptap/core').Editor;
  getHTML(): string;              // contract HTML (site paths)
  setHTML(html: string): void;    // does not fire onChange, clears undo history
  isUploading(): boolean;
  stats(): { words: number; minutes: number };
  focusStart(): void;
  openShortcuts(): void;          // keyboard/markdown shortcut sheet
  destroy(): void;
};
export function createEditor(opts: {
  element: HTMLElement;
  onChange: () => void;
  upload: (file: File) => Promise<{ src: string; preview: string }>;
  onUploadsChange?: (pending: number) => void;
  onMessage?: (msg: string, kind?: 'info' | 'error') => void;
}): EditorHandle;
```
EDITOR owns all in-text formatting UI: selection bubble menu, link popover (⌘K),
slash "/" insert menu, image figure UI (caption, alt, replace, remove, upload progress),
paste/drop images, typography, code blocks, shortcuts sheet (⌘/), and the mobile
formatting bar. The page's top bar (owned by APP) will NOT contain formatting buttons.

## APP (owns src/pages/write.astro, src/scripts/write/main.ts, src/scripts/write/ui/**)

Page shell: top bar (save state, word count, Posts, Preview, Publish, overflow menu),
publish sheet (slug, date, summary, cover, link-preview card, explicit "Publish to
benxie.garden/blog/<slug>"), posts panel (search, Drafts/Published tabs, local
unsaved markers, new post, delete), settings/onboarding (token), conflict dialog,
version history, cover picker, unsaved-changes guards, keyboard shortcuts for app
actions (⌘S etc.). Uses only the interfaces above.
