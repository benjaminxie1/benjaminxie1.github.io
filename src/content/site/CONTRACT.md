# Site text editing: contract

Goal: Ben can edit every piece of text on Home, Experience and Contact (and the shared
site info: name, email, social links, nav labels, meta description) from /write,
in place, and save it to GitHub. Scope for now: edit existing text and link URLs only
(no adding/removing/reordering items, no images).

## Data (owned by CONTENT)

- One JSON file per page in `src/content/site/`: `home.json`, `experience.json`,
  `contact.json`, plus `site.json` for shared info (name, short, description, email,
  github, linkedin, x, nav labels). `src/data/site.ts` keeps exporting `site` and `nav`
  (now read from site.json) so the rest of the code doesn't change.
- Text fields that may contain formatting are **inline markdown**: only `**bold**`,
  `*italic*`, and `[text](url)`. Everything else is plain text. Rendering always escapes
  HTML first, so the JSON can never inject markup.
- Shared helper `src/lib/inline.ts` (CONTENT writes it; EDITOR imports it):
  - `renderInline(md: string): string` → safe HTML (`<strong>`, `<em>`, `<a href>`; http(s),
    mailto:, and site-relative `/…` URLs only; others become plain text).
  - `inlineFromNode(el: Element): string` → inverse, for the editor (walks child nodes;
    `<b>/<strong>` → `**`, `<i>/<em>` → `*`, `<a href>` → `[..](..)`, `<br>`/newlines → space,
    everything else → its text). `inlineFromNode(el)` after `el.innerHTML = renderInline(x)`
    must return `x` for any `x` produced by `renderInline`'s grammar.

## Editable markers in the rendered pages (owned by CONTENT)

Every editable thing in the built HTML carries attributes:
- `data-edit="<file>:<json-pointer>"` e.g. `data-edit="home:/paragraphs/1"`,
  `data-edit="experience:/jobs/0/role"`, `data-edit="site:/email"`.
  `<file>` is the JSON file name without `.json`. JSON pointer per RFC 6901.
- `data-edit-kind="inline"` (rich: bold/italic/links allowed) or `"plain"` (text only, no
  formatting, single line).
- Links whose URL is editable but whose text is NOT separately stored carry
  `data-edit-href="<file>:<json-pointer>"` (the pointer to the URL string). An element may
  have both `data-edit` (its text) and `data-edit-href` (its URL).
- Text the element shows must be exactly `renderInline(value)` (inline) or the plain value,
  with no extra characters inside the element (punctuation like a trailing "." goes outside).
- Pages render identically to before (verify with screenshots at 1440 and 390).

## Editor (owned by EDITOR)

- /write gets a mode switch: **Posts** | **Site**. Site mode lists pages (Home,
  Experience, Contact) and shows the real page in a same-origin iframe (`/`, `/experience`,
  `/contact`), with an editing script injected into it that:
  - fetches the current JSON from GitHub (repo copy is the source of truth; the deployed
    page may be stale) and re-renders every `[data-edit]` from it with `renderInline`;
  - makes `[data-edit]` elements contenteditable (plain: no formatting, Enter blocked;
    inline: ⌘B/⌘I/⌘K + a small selection toolbar with Bold, Italic, Link);
  - lets you edit `[data-edit-href]` URLs via a small popover (click the link while editing);
  - shows subtle hover outlines on editable things, and a changed-state marker;
  - blocks navigation clicks inside the iframe while editing.
- Changes are tracked per file; local autosave (localStorage) of unsaved edits;
  "Publish changes" commits each changed JSON file to GitHub (reuse github.ts helpers;
  sha conflict detection), then shows deploy status (reuse deployStatus). Discard / undo,
  and a review list of changed fields before publishing.
