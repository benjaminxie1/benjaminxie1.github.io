# Site editor v2: structure, images, details — contract

Builds on v1 (text editing via `data-edit` / `data-edit-kind` / `data-edit-href`, JSON in
`src/content/site/*.json`, inline markdown via `src/lib/inline.ts`, editor in
`src/scripts/write/site/**`). v1 keeps working unchanged.

Goal: from /write → Site, Ben can **add, remove, duplicate and reorder** every repeated thing
(home paragraphs, home/contact link lists, nav items, jobs, projects, a project's links,
the Recourse-style mock rows), **swap/upload/crop/remove images** (job logos, project images,
sponsor logos), **edit details that aren't visible text** (URLs behind titles, alt text,
logo height, dark-logo flag, link icon type, optional parts like "(3 mo)", badge, image, mock),
all with a live, faithful preview, undo/redo, validation and a review before publishing.

## 1. Schema (owned by CONTENT): `src/content/site/schema.ts`

A plain TS module (no Astro imports) exported as `siteSchema`, imported by both the pages
(for build-time validation/coercion) and the editor (inspector, defaults, validation).

```ts
type Field =
  | { type: 'plain' | 'inline'; label: string; required?: boolean; placeholder?: string; help?: string; multiline?: false }
  | { type: 'url'; label: string; required?: boolean; help?: string; allowRelative?: boolean }   // http(s)/mailto or /path
  | { type: 'image'; label: string; required?: boolean; help?: string; dir: string; alt?: string /* sibling key holding alt text */ }
  | { type: 'number'; label: string; min?: number; max?: number; step?: number; default?: number; help?: string }
  | { type: 'boolean'; label: string; help?: string }
  | { type: 'select'; label: string; options: { value: string; label: string }[]; required?: boolean }
  | { type: 'object'; label: string; fields: Record<string, Field>; optional?: boolean /* can be toggled on/off */; default?: unknown }
  | { type: 'list'; label: string; itemLabel: string /* "job", "project", "link" */; item: Field /* usually object */;
      summary?: string /* key used to label items in UI */; min?: number; max?: number; newItem: unknown /* default value for "Add" */ };
// every Field may also carry: optional?: boolean (key may be absent), key order = JSON key order.
export const siteSchema: Record<'site' | 'home' | 'experience' | 'contact', { label: string; fields: Record<string, Field> }>;
export function validateFile(file: string, data: unknown): { path: string; message: string }[];   // JSON pointers
export function coerceFile(file: string, data: unknown): unknown;  // fill defaults, drop unknown junk safely, never throw
```
Pages call `coerceFile` on load (build never fails because of a bad value; it logs a warning).

## 2. Markup markers (owned by CONTENT), in addition to v1's

- **Lists**: the element that directly contains the items carries
  `data-edit-list="<file>:<pointer-to-array>"`. Each item root carries
  `data-edit-item="<file>:<pointer-to-item>"` (e.g. `experience:/jobs/2`). Items are the list
  element's direct children in array order (non-item children like separators are allowed but
  must not carry `data-edit-item`).
- **Templates**: for every list, the page renders one hidden
  `<template data-edit-template="<file>:<pointer-to-array>">` (anywhere on the page) containing a
  single item rendered from the schema's `newItem`, with the literal token `__i__` in place of
  the index in every pointer inside it (e.g. `data-edit="experience:/jobs/__i__/role"`). The
  editor instantiates new items from it. Nested lists inside a templated item render their own
  inner template inside the item using `__j__`.
- **Images**: `<img data-edit-img="<file>:<pointer-to-src>" data-edit-alt="<file>:<pointer-to-alt>">`.
  If the image is optional, its wrapper carries `data-edit-optional="<file>:<pointer>"`.
- **Optional parts**: any element that only shows when a value/object is present
  (e.g. job `span` "(3 mo)", project `image`, `mock`, `badge`) is ALWAYS rendered, wrapped in an
  element with `data-edit-optional="<file>:<pointer>"` and the `hidden` attribute when absent.
  Inside it, the normal `data-edit` markers (with the default/placeholder value).
- **Details-only fields** (not visible as text): nothing extra needed — the editor finds them
  through the schema from the nearest `data-edit-item` (or the file root).
- Empty lists must render cleanly (the list element still exists, possibly empty).
- No visual change to the live pages vs today (verify with screenshots).

**As implemented (CONTENT, v2)** — rules the editor can rely on:
- A list element contains **only** its items (wrappers like `.paras` / `.rc-rows` use
  `display: contents`). Insert new items as its children. Each list's template is the list
  element's **next sibling** (`list.parentElement.querySelector(':scope > template[data-edit-template="…"]')`).
- Tokens: top-level lists use `__i__`; lists nested in an item (`/projects/N/links`,
  `/projects/N/mock/rows`) use `__j__`, also in real items' inner templates. Instantiate by
  string-replacing the token in `template.innerHTML` (an outer replace of `__i__` also fixes the
  inner template). Item root may itself carry `data-edit` (nav link, paragraph, home/contact link).
- `data-edit-optional` is on the element that shows/hides; it is `hidden` iff the key is **absent**
  (`undefined`); it never carries `data-edit` itself. Hidden parts render the field's default
  (`defaultAt(file, pointer)` in schema.ts), so switching on = set value to `defaultAt(...)`.
  `[data-edit-optional][hidden]{display:none!important}` is in global.css. Project image wins
  over mock by CSS when both exist.
- Detail bindings (live preview without re-rendering), all values `<file>:<pointer>`,
  space-separated bindings:
  - `data-edit-attr="attr=<ptr>[|<ptr>…]"` – set attr to the first non-empty value (for `href`,
    pass through `hrefOf`); remove when none. (nav href, project-link title, project image link.)
  - `data-edit-class="cls=<ptr>"` / `cls=!<ptr>` – toggle class on truthy / falsy value.
  - `data-edit-style="prop=<ptr>"` – numbers get `px` (sponsor logo height).
  - `data-edit-icon="<ptr>"` on an SVG `<path>` – `d = iconPath(value)`.
  - `data-edit-sitelink="<ptr-to-item>"` (home/contact links) – `href` and `data-edit-href` come
    from `resolveSiteLink(item, siteData, ptr)`: custom `href` wins, else the shared site link
    (`site:/github` …), `email` → `mailto:` with no `data-edit-href`.
  - `aria-label` / `aria-current` are not live-updated.
- `tests/site-templates.test.mjs` is a reference implementation of "fill a subtree from data"
  using only these markers, and checks every template against the real items.

## 3. Images (owned by CONTENT + EDITOR)

- Site images live in `public/site/` (new uploads) — existing paths (`/logos/…`, `/sponsors/…`,
  `/projects/…`) stay valid. `github.ts` `uploadImage(file, baseName, opts?: { dir?: string; keepAlpha?: boolean })` (`keepPng` = alias)
  gains a `dir` option (default stays `public/blog`); logos keep transparency (PNG/SVG input →
  PNG/webp with alpha; never flatten onto white).

## 4. Editor (owned by EDITOR): everything in `src/scripts/write/site/**`

- **Item controls**: hovering/focusing an item shows a small floating toolbar: drag handle,
  Move up / Move down, Duplicate, Delete (with undo toast, no confirm dialog), Details.
  "+ Add <itemLabel>" affordance at the end of each list (and in empty lists). Drag-and-drop
  reorder within a list (pointer + keyboard alternative). Respect `min`/`max`.
- **Inspector** (side panel on desktop, bottom sheet on mobile) for the selected item / file:
  every schema field, grouped; visible text fields mirror the in-page editing; URL fields
  validated; images with Upload / Replace / Crop (reuse `src/scripts/write/editor/crop.ts` if
  practical) / Remove + alt text; selects, numbers, booleans; optional parts as toggles;
  nested lists (project links, mock rows) with add/remove/reorder.
- **Live preview**: every change (text, structure, image, optional toggle, details like logo
  height/dark flag) updates the iframe immediately, using templates + renderInline. After
  structural changes, all `__i__`/index pointers inside a list must be renumbered.
- **Undo/redo** (⌘Z / ⇧⌘Z, plus buttons) over ALL operations, per session.
- **Validation** before publish via `validateFile`; blocking issues listed with "Show" jumping
  to the field.
- **Review** shows added / removed / moved items and field changes (text diff), images
  (old → new thumbnails).
- **Autosave/conflicts**: unchanged guarantees from v1, extended to structure (whole-file
  three-way merge only when safe; otherwise ask).
- Posts mode untouched; v1 text editing behaviour unchanged.
