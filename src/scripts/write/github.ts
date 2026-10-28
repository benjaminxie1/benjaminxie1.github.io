// GitHub REST helpers (contents API) for the /write editor.
import { OWNER, REPO, BRANCH, TOKEN_KEY, store } from './lib';

// ---------- GitHub ----------
export const token = () => store.get(TOKEN_KEY) || '';
export async function gh(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token()}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(res.status === 401 ? 'GitHub key is invalid or expired' : res.status === 403 ? 'GitHub key doesn’t have write access' : body.message || `GitHub error ${res.status}`);
  }
  return res;
}
export const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
export const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
export async function getFile(path: string) {
  const r = await gh(`/contents/${path}?ref=${BRANCH}`);
  if (r.status === 404) return null;
  return r.json();
}
export async function putFile(path: string, base64: string, message: string, sha?: string | null) {
  const body = JSON.stringify({ message, content: base64, branch: BRANCH, ...(sha ? { sha } : {}) });
  let r = await gh(`/contents/${path}`, { method: 'PUT', body });
  if (r.status === 404) throw new Error('Repo not found: check the key’s repository access');
  return r.json();
}

