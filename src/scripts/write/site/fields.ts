// The site schema (src/content/site/schema.ts) seen from the editor: which field a JSON
// pointer is, labels and summaries for the UI, defaults for new items and optional parts.
import { siteSchema, validateFile, fieldAt as schemaFieldAt, defaultAt, type Field } from '../../../content/site/schema';
import { tokens, isIndex, join, getPtr, clone } from './pointer';

export type { Field };
export type ListField = Extract<Field, { type: 'list' }>;
export type ObjectField = Extract<Field, { type: 'object' }>;
export { validateFile };

export const FILE_LABEL: Record<string, string> = { home: 'Home', experience: 'Experience', contact: 'Contact', site: 'Every page' };
export const fileLabel = (f: string) => FILE_LABEL[f] || siteSchema[f as keyof typeof siteSchema]?.label || f;

export function rootField(file: string): ObjectField | null {
  const s = (siteSchema as Record<string, { label: string; fields: Record<string, Field> }>)[file];
  return s ? { type: 'object', label: s.label, fields: s.fields } : null;
}

/** The schema field describing the value at ptr ('' = the file's root object). */
export const fieldAt = (file: string, ptr: string): Field | null => schemaFieldAt(file, ptr);
export const listAt = (file: string, ptr: string): ListField | null => { const f = fieldAt(file, ptr); return f?.type === 'list' ? f : null; };
/** Key order of the object at ptr, from the schema (null if unknown). */
export const orderAt = (file: string, ptr: string): string[] | null => { const f = fieldAt(file, ptr); return f?.type === 'object' ? Object.keys(f.fields) : null; };
export const isOptional = (f: Field | null | undefined) => !!(f && (f as { optional?: boolean }).optional);

/** Inline markdown → its visible text. */
export const plainText = (s: string) => s.replace(/\\([\\*[\]()])/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** "job", "project"… for the list at listPtr. */
export const itemLabel = (file: string, listPtr: string) => listAt(file, listPtr)?.itemLabel || 'item';
export const ItemLabel = (file: string, listPtr: string) => cap(itemLabel(file, listPtr));

/** A short name for one item: its summary field's text, else "Job 2". */
export function summary(file: string, listPtr: string, idx: number, value: unknown): string {
  const l = listAt(file, listPtr);
  const name = `${cap(l?.itemLabel || 'item')} ${idx + 1}`;
  if (typeof value === 'string') return value.trim() ? short(plainText(value)) : name;
  const k = l?.summary || (l?.item.type === 'object' ? l.item.summary : undefined);
  const v = k && value && typeof value === 'object' ? (value as Record<string, unknown>)[k] : undefined;
  if (typeof v === 'string' && v.trim()) return short(plainText(v));
  // fall back to the first short text field
  if (value && typeof value === 'object' && l?.item.type === 'object') {
    for (const [fk, ff] of Object.entries(l.item.fields)) {
      const x = (value as Record<string, unknown>)[fk];
      if ((ff.type === 'plain' || ff.type === 'inline') && typeof x === 'string' && x.trim()) return short(plainText(x));
    }
  }
  return name;
}

/** Breadcrumb labels for ptr: ['Projects', 'LabTwin', 'Pitch']. */
export function crumbs(file: string, ptr: string, data: unknown): string[] {
  const out: string[] = [];
  let f: Field | null = rootField(file);
  let p = '';
  for (const t of tokens(ptr)) {
    if (!f) { out.push(t); continue; }
    if (f.type === 'list' && isIndex(t)) { out.push(summary(file, p, +t, getPtr(data, join(p, t)))); f = f.item; }
    else if (f.type === 'object') { f = f.fields[t] ?? null; out.push(f?.label || t); }
    else { out.push(t); f = null; }
    p = join(p, t);
  }
  return out;
}

/** The value an optional part gets when switched on (a flag switched on is true). */
export function onValue(file: string, ptr: string): unknown {
  const f = fieldAt(file, ptr);
  if (f?.type === 'boolean') return true;
  return clone(defaultAt(file, ptr));
}
export const newItemFor = (l: ListField) => clone(l.newItem);

/** The image fields' alt text sibling key, if the schema names one. */
export const altKey = (f: Field | null) => (f?.type === 'image' ? f.alt : undefined);
