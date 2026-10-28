// GitHub connection: step-by-step token setup, test-before-store, test/forget.
import { token, setToken, clearToken, testToken } from '../github';
import { OWNER, REPO } from '../lib';
import { h } from './dom';
import { openDialog } from './dialog';
import { toast } from './toast';

const NEW_TOKEN = 'https://github.com/settings/personal-access-tokens/new';

async function tryToken(value: string) {
  // DATA's testToken(candidate) tests before storing; the stub reads the stored key,
  // so store it provisionally and roll back on failure (works with both).
  const prev = token();
  setToken(value);
  const res = await (testToken as (c?: string) => ReturnType<typeof testToken>)(value);
  if (!res.ok) { if (prev) setToken(prev); else clearToken(); }
  return res;
}

function steps() {
  const b = (t: string) => h('b', { text: t });
  return h('ol', { class: 'steps' },
    h('li', {}, 'Open ', h('a', { href: NEW_TOKEN, target: '_blank', rel: 'noopener' }, 'GitHub → new fine-grained token'), ' (opens in a new tab).'),
    h('li', {}, 'Name it ', b('blog editor'), ' and set ', b('Expiration'), ' to ', b('1 year'), '.'),
    h('li', {}, 'Under ', b('Repository access'), ' choose ', b('Only select repositories'), ' → ', b(`${REPO}`), '.'),
    h('li', {}, 'Under ', b('Permissions → Repository'), ' set ', b('Contents: Read and write'), '. Optional: ', b('Actions: Read-only'), ' so this page can tell you when a deploy is live.'),
    h('li', {}, b('Generate token'), ', copy it, and paste it below.'),
  );
}

/**
 * Open the connection dialog. Resolves true once a working key is stored
 * (so the caller can resume what the person was doing), false if dismissed.
 */
export async function connect(o: { reason?: string } = {}): Promise<boolean> {
  return token() ? manage() : setup(o.reason);
}

async function setup(reason?: string): Promise<boolean> {
  const inp = h('input', { class: 'field', type: 'password', id: 'tok-in', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'tok-msg' });
  const msg = h('p', { class: 'field-msg', id: 'tok-msg', 'aria-live': 'polite' });
  let ok = false;
  const { ctl, result } = openDialog({
    title: 'Connect GitHub',
    size: 'md',
    description: reason || 'Your writing already saves on this device. To save drafts online and publish, this browser needs a GitHub key. You only do this once.',
    body: [
      steps(),
      h('label', { class: 'label', for: 'tok-in', text: 'Your token' }), inp, msg,
      h('p', { class: 'fine', text: `The key stays in this browser only and can only touch ${OWNER}/${REPO}. You can forget it any time from the ⋯ menu.` }),
    ],
    focus: inp,
    actions: [
      { label: 'Not now', value: 'cancel', kind: 'ghost' },
      {
        label: 'Test and connect', value: 'ok', kind: 'primary', busyLabel: 'Testing…',
        run: async (c) => {
          const v = inp.value.trim();
          if (!v) { msg.textContent = 'Paste your token first.'; msg.className = 'field-msg bad'; inp.focus(); return false; }
          const res = await tryToken(v);
          if (!res.ok) { msg.textContent = res.message; msg.className = 'field-msg bad'; inp.focus(); return false; }
          msg.textContent = 'Connected ✓';
          msg.className = 'field-msg good';
          c.buttons.ok.textContent = 'Connected ✓';
          ok = true;
          await new Promise((r) => setTimeout(r, 650));
        },
      },
    ],
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctl.buttons.ok.click(); } });
  await result;
  if (ok) { toast('Connected to GitHub', { kind: 'ok' }); window.dispatchEvent(new Event('bx-token')); }
  return ok;
}

async function manage(): Promise<boolean> {
  const state = h('p', { class: 'conn-state good', 'aria-live': 'polite', text: `Connected ✓ to ${OWNER}/${REPO}` });
  const inp = h('input', { class: 'field', type: 'password', id: 'tok-new', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
  const replaceMsg = h('p', { class: 'field-msg', 'aria-live': 'polite' });
  const replace = h('details', { class: 'replace' },
    h('summary', { text: 'Replace the key' }),
    steps(), h('label', { class: 'label', for: 'tok-new', text: 'New token' }), inp, replaceMsg,
    h('button', {
      type: 'button', class: 'btn btn-ghost', text: 'Test and use this key', on: {
        click: async (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          if (!inp.value.trim()) return;
          b.disabled = true; replaceMsg.textContent = 'Testing…';
          const res = await tryToken(inp.value.trim());
          b.disabled = false;
          replaceMsg.textContent = res.ok ? 'Connected ✓ with the new key' : res.message + ' (kept your old key)';
          replaceMsg.className = 'field-msg ' + (res.ok ? 'good' : 'bad');
          if (res.ok) inp.value = '';
        },
      },
    }),
  );
  const { result } = openDialog({
    title: 'GitHub connection',
    size: 'md',
    body: [state, h('p', { class: 'fine', text: 'The key is stored in this browser only.' }), replace],
    actions: [
      {
        label: 'Forget this key', value: 'forget', kind: 'quiet',
        run: () => { clearToken(); window.dispatchEvent(new Event('bx-token')); toast('Key removed from this browser. Your writing still saves on this device.'); },
      },
      {
        label: 'Test connection', value: 'test', kind: 'ghost', busyLabel: 'Testing…',
        run: async () => {
          const res = await testToken();
          state.textContent = res.ok ? `Connected ✓ to ${OWNER}/${REPO} (tested just now)` : res.message;
          state.className = 'conn-state ' + (res.ok ? 'good' : 'bad');
          return false;
        },
      },
      { label: 'Done', value: 'done', kind: 'primary' },
    ],
    focus: '.btn-primary',
  });
  await result;
  return !!token();
}
