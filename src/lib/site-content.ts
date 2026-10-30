// Build-time loading of src/content/site/*.json: validate (warn only) and coerce to a safe,
// renderable shape, so a bad value never fails the build (see src/content/site/CONTRACT.md §1).
import { coerceFile, validateFile, type FileData, type SiteFileName } from '../content/site/schema';

const warned = new Set<string>();

export function loadSiteFile<K extends SiteFileName>(file: K, data: unknown): FileData[K] {
  const issues = validateFile(file, data);
  if (issues.length && !warned.has(file)) {
    warned.add(file);
    console.warn(`[site] ${file}.json has ${issues.length} problem(s); rendering with safe defaults:\n` +
      issues.map((i) => `  ${i.path || '/'}: ${i.message}`).join('\n'));
  }
  return coerceFile(file, data);
}
