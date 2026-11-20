// Branches: Liste (lokal und auf dem Server), anlegen, wechseln, umbenennen, löschen, zusammenführen.
import { h, showMenu, confirm, dialog, toast } from './ui.js';
import { icon } from './icons.js';
import { S, t, g, act, emit, relTime, fmtDate, emptyState, copyText, showError } from './common.js';
import { pushBranch, remoteOp } from './sync.js';

let sel = null; // { type: 'local'|'remote', name }
let filter = '';
export const branchState = () => ({ sel });
export const selectBranch = (type, name) => { sel = { type, name }; };

const current = () => (S.status ? S.status.branch : null);

// ---------------------------------------------------------------- Aktionen
export async function newBranchDialog(from = null) {
  const name = h('input', { class: 'input', spellcheck: 'false', placeholder: t('branchNamePh') });
  const checkout = h('input', { type: 'checkbox', checked: true });
  const err = h('p', { class: 'form-error' });
  const fromLabel = from ? (from.length >= 40 ? from.slice(0, 7) : from) : current() || 'HEAD';
  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', { text: t('branchName') }), name),
    h('p', { class: 'hint', text: t('branchFrom', { b: fromLabel }) }),
    h('label', { class: 'check' }, checkout, t('switchAfter')), err);
  name.addEventListener('input', () => {
    // Leerzeichen sind in Branch-Namen verboten: gleich durch Bindestriche ersetzen
    const p = name.selectionStart;
    name.value = name.value.replace(/\s/g, '-');
    name.setSelectionRange(p, p);
  });
  for (;;) {
    const r = await dialog({ title: t('newBranch'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('create'), value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    const n = name.value.trim();
    if (!n || !(await g('checkRefName', n))) {
      err.textContent = t('errBadName');
      continue;
    }
    if (S.refs.local.some((b) => b.name === n)) {
      err.textContent = t('branchExists');
      continue;
    }
    const ok = await act(async () => {
      await g('createBranch', n, { from, checkout: checkout.checked });
      return true;
    });
    if (ok) {
      sel = { type: 'local', name: n };
      toast(checkout.checked ? t('branchCreatedSwitched', { b: n }) : t('branchCreated', { b: n }));
    }
    return;
  }
}

/** Wechseln; bei Änderungen, die im Weg wären, anbieten sie mitzunehmen (Stash) */
export async function switchTo(name, remote = false) {
  const run = () => (remote ? g('checkoutRemote', name) : g('switchBranch', name));
  S.busy++;
  emit('busy');
  try {
    await run();
    toast(t('switchedTo', { b: remote ? name.split('/').slice(1).join('/') : name }));
  } catch (e) {
    if (e.code === 'DIRTY') {
      const r = await confirm(t('dirtyTitle'), t('dirtyMsg', { b: name }), [{ label: t('cancel'), value: 'cancel' }, { label: t('stashAndSwitch'), value: 'stash', primary: true }]);
      if (r === 'stash') {
        await act(async () => {
          await g('stashPush', { message: t('autoStashMsg', { b: current() || 'HEAD' }), untracked: true });
          await run();
          toast(t('stashedAndSwitched'));
        }, { refresh: false });
      }
    } else {
      await showError(e);
    }
  } finally {
    S.busy--;
    emit('busy');
    emit('refresh');
  }
}

async function renameDialog(b) {
  const name = h('input', { class: 'input', spellcheck: 'false', value: b.name });
  const err = h('p', { class: 'form-error' });
  const body = h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', { text: t('branchName') }), name),
    b.upstream ? h('p', { class: 'hint', text: t('renameHint') }) : null, err);
  for (;;) {
    const r = await dialog({ title: t('renameBranch'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('rename'), value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    const n = name.value.trim();
    if (n === b.name) return;
    if (!n || !(await g('checkRefName', n))) {
      err.textContent = t('errBadName');
      continue;
    }
    const ok = await act(async () => {
      await g('renameBranch', b.name, n);
      return true;
    });
    if (ok) sel = { type: 'local', name: n };
    return;
  }
}

async function deleteLocal(b) {
  if (b.current) return toast(t('cantDeleteCurrent'), { kind: 'error' });
  const r = await confirm(t('deleteBranchTitle'), t('deleteBranchMsg', { b: b.name }), [{ label: t('cancel'), value: 'cancel' }, { label: t('delete'), value: 'ok', danger: true, primary: true }]);
  if (r !== 'ok') return;
  try {
    await g('deleteBranch', b.name, false);
  } catch (e) {
    if (e.code !== 'NOT_MERGED') return act(() => Promise.reject(e));
    const r2 = await confirm(t('notMergedTitle'), t('notMergedMsg', { b: b.name }), [{ label: t('cancel'), value: 'cancel' }, { label: t('deleteAnyway'), value: 'ok', danger: true, primary: true }]);
    if (r2 !== 'ok') return;
    await act(() => g('deleteBranch', b.name, true));
  }
  sel = null;
  toast(t('branchDeleted', { b: b.name }));
  emit('refresh');
}

async function deleteRemote(b) {
  const r = await confirm(t('deleteRemoteTitle'), t('deleteRemoteMsg', { b: b.name }), [{ label: t('cancel'), value: 'cancel' }, { label: t('delete'), value: 'ok', danger: true, primary: true }]);
  if (r !== 'ok') return;
  await remoteOp('deleteRemoteBranch', t('deletingRemote'), b.remote, b.branch);
  sel = null;
}

export async function mergeInto(name) {
  const cur = current();
  if (!cur) return toast(t('needBranch'), { kind: 'error' });
  const noFf = h('input', { type: 'checkbox' });
  const body = h('div', {}, h('p', { class: 'dialog-text', text: t('mergeMsg', { a: name, b: cur }) }), h('label', { class: 'check' }, noFf, t('mergeNoFf')));
  const r = await dialog({ title: t('mergeTitle'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('mergeGo'), value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  const res = await act(() => g('merge', name, { noFf: noFf.checked }));
  if (!res) return;
  if (res.conflict) {
    await confirm(t('conflictTitle'), t('mergeConflictMsg', { a: name, b: cur }), [{ label: t('ok'), value: 'ok', primary: true }]);
    emit('tab', 'changes');
  } else toast(res.upToDate ? t('mergeUpToDate') : t('mergeDone', { a: name, b: cur }));
}

function localMenu(e, b) {
  e.preventDefault();
  showMenu([
    { label: t('switchBranch'), disabled: b.current, run: () => switchTo(b.name) },
    { label: t('mergeIntoCurrent', { b: current() || 'HEAD' }), disabled: b.current || !current(), run: () => mergeInto(b.name) },
    { label: t('branchFromHere'), run: () => newBranchDialog(b.name) },
    { label: t('viewHistory'), run: () => emit('ref-history', b.name) },
    '-',
    { label: b.upstream ? t('pushBranch') : t('publishBranch'), run: () => pushBranch(b) },
    { label: t('rename'), run: () => renameDialog(b) },
    { label: t('copyName'), run: () => copyText(b.name) },
    '-',
    { label: t('delete'), disabled: b.current, run: () => deleteLocal(b) },
  ], e.clientX, e.clientY);
}
function remoteMenu(e, b) {
  e.preventDefault();
  showMenu([
    { label: t('checkoutRemote'), run: () => switchTo(b.name, true) },
    { label: t('mergeIntoCurrent', { b: current() || 'HEAD' }), disabled: !current(), run: () => mergeInto(b.name) },
    { label: t('viewHistory'), run: () => emit('ref-history', b.name) },
    { label: t('copyName'), run: () => copyText(b.name) },
    '-',
    { label: t('deleteOnServer'), run: () => deleteRemote(b) },
  ], e.clientX, e.clientY);
}

// ---------------------------------------------------------------- Seitenleiste
function track(b) {
  const out = [];
  if (b.ahead) out.push(h('span', { class: 'track up', title: t('aheadTip', { n: b.ahead }) }, `↑${b.ahead}`));
  if (b.behind) out.push(h('span', { class: 'track down', title: t('behindTip', { n: b.behind }) }, `↓${b.behind}`));
  if (b.gone) out.push(h('span', { class: 'track gone', title: t('goneTip'), text: t('gone') }));
  return out;
}

export function renderSide(box) {
  const refs = S.refs;
  if (sel && !(sel.type === 'local' ? refs.local : refs.remote).some((b) => b.name === sel.name)) sel = null;
  if (!sel && refs.local.length) sel = { type: 'local', name: (refs.local.find((b) => b.current) || refs.local[0]).name };
  const search = h('input', { class: 'input search-input', placeholder: t('filterBranches'), value: filter, spellcheck: 'false' });
  search.addEventListener('input', () => {
    filter = search.value;
    emit('render');
    requestAnimationFrame(() => {
      const s = document.querySelector('.search-input');
      if (s) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    });
  });
  const f = filter.trim().toLowerCase();
  const match = (n) => !f || n.toLowerCase().includes(f);
  const row = (b, type) => h('div', {
    class: `row branch${sel && sel.type === type && sel.name === b.name ? ' on' : ''}${b.current ? ' current' : ''}`,
    'data-name': b.name,
    onclick: () => { sel = { type, name: b.name }; emit('render'); },
    ondblclick: () => (type === 'local' ? !b.current && switchTo(b.name) : switchTo(b.name, true)),
    oncontextmenu: (e) => (type === 'local' ? localMenu(e, b) : remoteMenu(e, b)),
  }, h('span', { class: 'br-ico' }, b.current ? icon('check', 15) : icon(type === 'local' ? 'branch' : 'cloud', 15)),
  h('div', { class: 'br-text' }, h('span', { class: 'br-name', text: type === 'remote' ? b.branch : b.name }), h('small', { text: `${b.subject || ''}` })),
  ...track(b), h('span', { class: 'muted small time', text: relTime(b.time) }));
  const list = h('div', { class: 'side-scroll' });
  const locals = refs.local.filter((b) => match(b.name));
  list.append(h('div', { class: 'sect' }, h('div', { class: 'sect-head' }, h('span', { class: 'sect-title', text: t('localBranches') }), h('span', { class: 'count', text: String(refs.local.length) })), h('div', { class: 'rows' }, locals.map((b) => row(b, 'local')))));
  const byRemote = new Map();
  for (const b of refs.remote) if (match(b.name)) {
    if (!byRemote.has(b.remote)) byRemote.set(b.remote, []);
    byRemote.get(b.remote).push(b);
  }
  for (const [remote, items] of byRemote) {
    list.append(h('div', { class: 'sect' }, h('div', { class: 'sect-head' }, icon('cloud', 13), h('span', { class: 'sect-title', text: remote }), h('span', { class: 'count', text: String(items.length) })), h('div', { class: 'rows' }, items.map((b) => row(b, 'remote')))));
  }
  if (!refs.local.length && !refs.remote.length) list.append(h('div', { class: 'side-empty' }, icon('branch', 22), h('span', { text: t('noBranchesYet') })));
  box.replaceChildren(h('div', { class: 'side-tools' }, h('div', { class: 'tool-row' }, h('div', { class: 'search-box' }, icon('search', 15), search),
    h('button', { class: 'btn primary', title: t('newBranch'), onclick: () => newBranchDialog() }, icon('plus', 15), t('new')))), list);
}

// ---------------------------------------------------------------- Hauptbereich
let token = 0;
export async function renderMain(box) {
  const my = ++token;
  if (!sel) {
    box.replaceChildren(emptyState('branch', t('noBranchesYet'), t('noBranchesText')));
    return;
  }
  const b = (sel.type === 'local' ? S.refs.local : S.refs.remote).find((x) => x.name === sel.name);
  if (!b) return;
  const cur = current();
  const actions = h('div', { class: 'main-actions' });
  if (sel.type === 'local') {
    if (!b.current) actions.append(h('button', { class: 'btn primary', onclick: () => switchTo(b.name) }, icon('check', 15), t('switchBranch')));
    if (!b.current && cur) actions.append(h('button', { class: 'btn', onclick: () => mergeInto(b.name) }, icon('merge', 15), t('mergeIntoCurrent', { b: cur })));
    actions.append(h('button', { class: 'btn', onclick: () => pushBranch(b) }, icon('push', 15), b.upstream ? t('push') : t('publishBranch')));
    actions.append(h('button', { class: 'icon-btn menu-anchor', title: t('more'), onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      localMenu({ preventDefault() {}, clientX: r.right - 220, clientY: r.bottom + 4 }, b);
    } }, icon('more', 18)));
  } else {
    actions.append(h('button', { class: 'btn primary', onclick: () => switchTo(b.name, true) }, icon('check', 15), t('checkoutRemote')));
    if (cur) actions.append(h('button', { class: 'btn', onclick: () => mergeInto(b.name) }, icon('merge', 15), t('mergeIntoCurrent', { b: cur })));
    actions.append(h('button', { class: 'btn ghost danger', onclick: () => deleteRemote(b) }, icon('trash', 15), t('deleteOnServer')));
  }
  const info = h('div', { class: 'branch-card' },
    h('div', { class: 'bc-top' }, h('span', { class: 'bc-ico' }, icon(sel.type === 'local' ? 'branch' : 'cloud', 22)),
      h('div', {}, h('h2', { text: b.name }), h('small', { class: 'muted', text: sel.type === 'local' ? (b.upstream ? t('tracks', { u: b.upstream }) : t('notPublished')) : t('onServer', { r: b.remote }) })),
      h('span', { class: 'spacer' }), actions),
    h('div', { class: 'bc-last' }, t('lastCommit'), ': ', h('b', { text: b.subject || '' }), ' · ', h('span', { title: fmtDate(b.time), text: relTime(b.time) })));
  const lists = h('div', { class: 'compare' }, h('div', { class: 'loading', text: t('loading') }));
  box.replaceChildren(h('div', { class: 'main-scroll pad' }, info, lists));
  if (b.current || !cur) {
    const own = await g('log', { ref: b.name, max: 30 });
    if (my !== token) return;
    lists.replaceChildren(commitBlock(t('recentCommits'), own, b.name));
    return;
  }
  const [only, missing] = await Promise.all([g('log', { ref: `${cur}..${b.name}`, max: 100 }), g('log', { ref: `${b.name}..${cur}`, max: 100 })]);
  if (my !== token) return;
  lists.replaceChildren(commitBlock(t('onlyOn', { a: sel.type === 'remote' ? b.name : b.name, b: cur }), only, b.name), commitBlock(t('onlyOn', { a: cur, b: b.name }), missing, cur));
}

function commitBlock(title, commits, ref) {
  return h('div', { class: 'cblock' },
    h('div', { class: 'sect-head' }, h('span', { class: 'sect-title', text: title }), h('span', { class: 'count', text: commits.length >= 100 ? '100+' : String(commits.length) })),
    commits.length ? h('div', { class: 'rows' }, commits.map((c) => h('div', { class: 'row commit mini', onclick: () => emit('ref-history', ref, c.hash) },
      h('span', { class: 'subj', text: c.subject }), h('span', { class: 'muted small', text: `${c.author} · ${relTime(c.time)}` }), h('code', { text: c.short }))))
      : h('p', { class: 'muted small pad-l', text: t('nothingHere') }));
}
