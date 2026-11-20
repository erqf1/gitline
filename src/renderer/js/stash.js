// Stash: Änderungen beiseitelegen, wieder anwenden, löschen und ansehen.
import { h, confirm, dialog, toast, showMenu } from './ui.js';
import { icon } from './icons.js';
import { S, t, g, act, emit, relTime, fmtDate, emptyState } from './common.js';
import { filesAndDiff } from './history.js';
import { changeCount } from './changes.js';

let sel = null;
const fileState = {};

export async function stashDialog() {
  if (!changeCount()) return toast(t('nothingToStash'));
  const msg = h('input', { class: 'input', spellcheck: 'false', placeholder: t('stashMsgPh') });
  const untracked = h('input', { type: 'checkbox', checked: true });
  const body = h('div', { class: 'form' }, h('p', { class: 'dialog-text', text: t('stashText') }), h('label', { class: 'field' }, h('span', { text: t('stashMsg') }), msg), h('label', { class: 'check' }, untracked, t('stashUntracked')));
  const r = await dialog({ title: t('stashTitle'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('stashGo'), value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  const ok = await act(() => g('stashPush', { message: msg.value, untracked: untracked.checked }));
  if (ok) {
    sel = 'stash@{0}';
    toast(t('stashed'));
  }
}

async function apply(s, pop) {
  const r = await act(() => g('stashApply', s.ref, pop));
  if (!r) return;
  if (r.conflict) {
    toast(t('conflictsFound'), { kind: 'error' });
    emit('tab', 'changes');
  } else {
    toast(pop ? t('stashPopped') : t('stashApplied'));
    if (pop) sel = null;
  }
}
async function drop(s) {
  const r = await confirm(t('stashDropTitle'), t('stashDropMsg', { m: s.message }), [{ label: t('cancel'), value: 'cancel' }, { label: t('delete'), value: 'ok', danger: true, primary: true }]);
  if (r !== 'ok') return;
  await act(() => g('stashDrop', s.ref));
  sel = null;
}

export function renderSide(box) {
  const list = h('div', { class: 'side-scroll' });
  if (sel && !S.stashes.some((s) => s.ref === sel)) sel = null;
  if (!sel && S.stashes[0]) sel = S.stashes[0].ref;
  for (const s of S.stashes) {
    list.append(h('div', { class: `row stash${s.ref === sel ? ' on' : ''}`, onclick: () => { sel = s.ref; emit('render'); }, oncontextmenu: (e) => {
      e.preventDefault();
      showMenu([{ label: t('stashApply'), run: () => apply(s, false) }, { label: t('stashPop'), run: () => apply(s, true) }, '-', { label: t('delete'), run: () => drop(s) }], e.clientX, e.clientY);
    } }, h('span', { class: 'br-ico' }, icon('stash', 15)), h('div', { class: 'br-text' }, h('span', { class: 'br-name', text: s.message || s.ref }), h('small', { text: `${s.branch} · ${relTime(s.time)}` }))));
  }
  if (!S.stashes.length) list.append(h('div', { class: 'side-empty' }, icon('stash', 22), h('span', { text: t('noStashes') }), h('p', { class: 'muted small', text: t('noStashesText') })));
  box.replaceChildren(h('div', { class: 'side-tools' }, h('button', { class: 'btn primary wide', disabled: !changeCount(), onclick: stashDialog }, icon('stash', 15), t('stashGo'))), list);
}

let token = 0;
export async function renderMain(box) {
  const my = ++token;
  const s = S.stashes.find((x) => x.ref === sel);
  if (!s) {
    box.replaceChildren(emptyState('stash', t('noStashes'), t('noStashesText')));
    return;
  }
  const files = await g('stashFiles', s.ref);
  if (my !== token) return;
  const card = h('div', { class: 'branch-card' }, h('div', { class: 'bc-top' }, h('span', { class: 'bc-ico' }, icon('stash', 22)),
    h('div', {}, h('h2', { text: s.message || s.ref }), h('small', { class: 'muted', text: `${s.ref} · ${t('onBranch', { b: s.branch })} · ${fmtDate(s.time)}` })),
    h('span', { class: 'spacer' }),
    h('div', { class: 'main-actions' },
      h('button', { class: 'btn ghost danger', onclick: () => drop(s) }, icon('trash', 15), t('delete')),
      h('button', { class: 'btn', title: t('stashApplyTip'), onclick: () => apply(s, false) }, t('stashApply')),
      h('button', { class: 'btn primary', title: t('stashPopTip'), onclick: () => apply(s, true) }, t('stashPop')))));
  const body = filesAndDiff(files, (f) => g('stashDiff', s.ref, f.path, f.untracked), (f) => [f.untracked || f.status === 'A' ? null : `${s.ref}^1`, f.status === 'D' ? null : f.untracked ? `${s.ref}^3` : s.ref], { state: fileState });
  box.replaceChildren(h('div', { class: 'details' }, card, body));
}
