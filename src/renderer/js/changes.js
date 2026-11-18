// Änderungen: nicht vorgemerkt / vorgemerkt / Konflikte, Diff der gewählten Datei und das Commit-Feld.
import { h, showMenu, confirm, dialog, toast } from './ui.js';
import { icon } from './icons.js';
import { S, t, g, api, act, emit, statusBadge, pathLabel, emptyState, showError, copyText, saveSettings, baseName } from './common.js';
import { diffView, conflictView, IMAGE_EXT } from './diffview.js';
import { parseDiff, buildPatch, buildLinePatch } from '../../shared/diff.js';
import { conflictKind } from '../../shared/status.js';
import { openIgnore, ignoreEntry, askIdentity, coAuthorDialog } from './dialogs.js';

// Auswahl: { area: 'unstaged'|'staged'|'conflicted', path }
let sel = null;
let draft = { summary: '', body: '', amend: false, coAuthors: [] };
let diffToken = 0;
export const changesState = () => ({ sel, draft });

const listOf = (area) => (S.status ? S.status[area] : []);
const findIn = (area, path) => listOf(area).find((f) => f.path === path);

export function changeCount() {
  if (!S.status) return 0;
  const set = new Set([...S.status.unstaged, ...S.status.staged, ...S.status.conflicted].map((f) => f.path));
  return set.size;
}

/** Nach dem Neuladen: Auswahl behalten oder sinnvoll weiterrücken */
function fixSelection() {
  if (sel && findIn(sel.area, sel.path)) return;
  if (sel) {
    // Datei ist in die andere Liste gewandert (z. B. vorgemerkt): dort weiter zeigen
    for (const area of ['conflicted', 'unstaged', 'staged']) if (findIn(area, sel.path)) return void (sel = { area, path: sel.path });
  }
  const first = ['conflicted', 'unstaged', 'staged'].map((a) => [a, listOf(a)[0]]).find(([, f]) => f);
  sel = first ? { area: first[0], path: first[1].path } : null;
}

export function select(area, path) {
  sel = { area, path };
  emit('render');
}

// ---------------------------------------------------------------- Seitenleiste
function fileRow(f, area) {
  const on = sel && sel.area === area && sel.path === f.path;
  const actionBtn = area === 'unstaged'
    ? h('button', { class: 'icon-btn small row-act', title: t('stage'), onclick: (e) => { e.stopPropagation(); act(() => g('stage', [f.path])); } }, icon('plus', 15))
    : area === 'staged'
      ? h('button', { class: 'icon-btn small row-act', title: t('unstage'), onclick: (e) => { e.stopPropagation(); act(() => g('unstage', [f.path, ...(f.oldPath ? [f.oldPath] : [])])); } }, icon('minus', 15))
      : null;
  return h('div', {
    class: `row file${on ? ' on' : ''}`,
    'data-path': f.path,
    onclick: () => select(area, f.path),
    ondblclick: () => {
      if (area === 'unstaged') act(() => g('stage', [f.path]));
      else if (area === 'staged') act(() => g('unstage', [f.path, ...(f.oldPath ? [f.oldPath] : [])]));
    },
    oncontextmenu: (e) => fileMenu(e, f, area),
  }, statusBadge(f.status), pathLabel(f.path, f.oldPath), actionBtn);
}

function fileMenu(e, f, area) {
  e.preventDefault();
  const full = `${S.repo}/${f.path}`;
  const items = [];
  if (area === 'unstaged') items.push({ label: t('stage'), run: () => act(() => g('stage', [f.path])) }, { label: t('discard'), run: () => discardFiles([f]) });
  if (area === 'staged') items.push({ label: t('unstage'), run: () => act(() => g('unstage', [f.path])) });
  if (area === 'conflicted') items.push(...conflictItems(f));
  items.push('-');
  if (f.status !== 'D') items.push({ label: t('openFile'), run: () => api.openPath(full) });
  if (S.textline && f.status !== 'D') items.push({ label: t('openInTextline'), run: () => api.openInTextline(full) });
  items.push({ label: t('showInFolder'), run: () => api.reveal(full) });
  items.push({ label: t('copyPath'), run: () => copyText(f.path) });
  items.push({ label: t('fileHistory'), disabled: f.status === '?', run: () => emit('file-history', f.path) });
  if (area === 'unstaged' && f.status === '?') {
    const ext = /\.([^./]+)$/.exec(f.path);
    const dir = f.path.includes('/') ? `${f.path.split('/').slice(0, -1).join('/')}/` : null;
    items.push('-', { label: t('ignoreFile'), run: () => ignoreEntry(f.path) });
    if (ext) items.push({ label: t('ignoreExt', { ext: `*.${ext[1]}` }), run: () => ignoreEntry(`*.${ext[1]}`) });
    if (dir) items.push({ label: t('ignoreFolder', { dir }), run: () => ignoreEntry(dir) });
  }
  showMenu(items, e.clientX, e.clientY);
}

function section(title, count, area, files, actionLabel, action) {
  const head = h('div', { class: 'sect-head' },
    h('span', { class: 'sect-title', text: `${title}` }), h('span', { class: 'count', text: String(count) }), h('span', { class: 'spacer' }),
    action ? h('button', { class: 'link-btn', text: actionLabel, onclick: action }) : null);
  return h('div', { class: `sect ${area}` }, head, h('div', { class: 'rows' }, files.map((f) => fileRow(f, area))));
}

export function renderSide(box) {
  fixSelection();
  const st = S.status;
  const parts = [];
  if (!st) {
    box.replaceChildren();
    return;
  }
  if (st.conflicted.length) parts.push(section(t('conflicts'), st.conflicted.length, 'conflicted', st.conflicted));
  parts.push(section(t('unstagedTitle'), st.unstaged.length, 'unstaged', st.unstaged, t('stageAll'), st.unstaged.length ? () => act(() => g('stageAll')) : null));
  parts.push(section(t('stagedTitle'), st.staged.length, 'staged', st.staged, t('unstageAll'), st.staged.length ? () => act(() => g('unstageAll')) : null));
  const list = h('div', { class: 'side-scroll' }, ...parts);
  if (!changeCount()) list.append(h('div', { class: 'side-empty' }, icon('check', 22), h('span', { text: t('cleanTree') })));
  box.replaceChildren(list, commitBox());
}

// ---------------------------------------------------------------- Commit-Feld
function commitBox() {
  const st = S.status;
  const branch = st.branch || t('detached');
  const summary = h('input', { class: 'input commit-summary', placeholder: t('summaryPh'), value: draft.summary, maxlength: 200, spellcheck: 'false' });
  const body = h('textarea', { class: 'input commit-body', placeholder: t('bodyPh'), spellcheck: 'false', rows: 3 });
  body.value = draft.body;
  const counter = h('span', { class: 'counter' });
  const amend = h('input', { type: 'checkbox', checked: draft.amend, disabled: st.initial });
  const coBtn = h('button', { class: `chip${draft.coAuthors.length ? ' on' : ''}`, title: t('coAuthorTip'), onclick: async () => {
    const list = await coAuthorDialog(draft.coAuthors);
    if (list) {
      draft.coAuthors = list;
      emit('render');
    }
  } }, icon('users', 13), draft.coAuthors.length ? t('coAuthorsN', { n: draft.coAuthors.length }) : t('coAuthor'));
  const go = h('button', { class: 'btn primary commit-btn' });
  const nothingStaged = !st.staged.length;
  const canCommitAll = nothingStaged && st.unstaged.length > 0;
  const update = () => {
    draft.summary = summary.value;
    draft.body = body.value;
    const n = summary.value.length;
    counter.textContent = n > 50 ? String(72 - n) : '';
    counter.classList.toggle('over', n > 72);
    const blocked = st.conflicted.length > 0;
    const ok = summary.value.trim() && !blocked && (draft.amend || !nothingStaged || canCommitAll);
    go.disabled = !ok;
    go.replaceChildren(icon('commit', 16), h('span', { text: draft.amend ? t('amendTo', { b: branch }) : canCommitAll ? t('commitAllTo', { b: branch }) : t('commitTo', { b: branch }) }));
  };
  summary.addEventListener('input', update);
  body.addEventListener('input', update);
  amend.addEventListener('change', async () => {
    draft.amend = amend.checked;
    if (amend.checked && !summary.value.trim() && !body.value.trim()) {
      const msg = await g('lastMessage');
      const [first, ...rest] = msg.replace(/\s+$/, '').split('\n');
      const co = [];
      const text = rest.filter((l) => {
        const m = /^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i.exec(l);
        if (m) co.push({ name: m[1], email: m[2] });
        return !m;
      }).join('\n').trim();
      draft.summary = first || '';
      draft.body = text;
      if (co.length) draft.coAuthors = co;
      emit('render');
      return;
    }
    update();
  });
  const doCommit = () => commitNow();
  go.addEventListener('click', doCommit);
  const keys = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !go.disabled) {
      e.preventDefault();
      doCommit();
    }
  };
  summary.addEventListener('keydown', keys);
  body.addEventListener('keydown', keys);
  update();
  return h('div', { class: 'commit-box' },
    h('div', { class: 'summary-row' }, avatarMini(), summary, counter),
    body,
    h('div', { class: 'commit-opts' }, h('label', { class: 'check small', title: t('amendTip') }, amend, t('amend')), h('span', { class: 'spacer' }), coBtn),
    go);
}

function avatarMini() {
  return h('span', { class: 'summary-ico' }, icon('edit', 15));
}

export async function commitNow() {
  const st = S.status;
  if (!draft.summary.trim()) return;
  if (st.conflicted.length) return;
  const all = !st.staged.length && st.unstaged.length && !draft.amend;
  const r = await act(async () => {
    if (all) await g('stageAll');
    try {
      return await g('commit', { summary: draft.summary, body: draft.body, coAuthors: draft.coAuthors, amend: draft.amend });
    } catch (e) {
      if (e.code === 'NO_IDENTITY') {
        if (await askIdentity()) return g('commit', { summary: draft.summary, body: draft.body, coAuthors: draft.coAuthors, amend: draft.amend });
        return undefined;
      }
      throw e;
    }
  }, { title: t('commitFailed') });
  if (r) {
    draft = { summary: '', body: '', amend: false, coAuthors: [] };
    toast(t('committed', { h: r.slice(0, 7) }));
    emit('committed', r);
  }
}

// ---------------------------------------------------------------- Verwerfen
export async function discardFiles(files) {
  if (!files.length) return;
  const msg = files.length === 1 ? t('discardOneMsg', { f: files[0].path }) : t('discardManyMsg', { n: files.length });
  const r = await confirm(t('discardTitle'), msg, [{ label: t('cancel'), value: 'cancel' }, { label: t('discard'), value: 'ok', danger: true, primary: true }]);
  if (r !== 'ok') return;
  await act(async () => {
    const untracked = files.filter((f) => f.status === '?').map((f) => f.path);
    const tracked = files.filter((f) => f.status !== '?').map((f) => f.path);
    if (tracked.length) await g('discard', tracked);
    if (untracked.length) await api.trash(S.repo, untracked);
  });
}

// ---------------------------------------------------------------- Hauptbereich
function conflictItems(f) {
  const items = [
    { label: t('takeOurs'), run: () => act(() => g('resolveWith', f.path, 'ours')) },
    { label: t('takeTheirs'), run: () => act(() => g('resolveWith', f.path, 'theirs')) },
    { label: t('markResolved'), run: () => act(() => g('markResolved', f.path)) },
  ];
  return items;
}

async function renderConflict(box, f) {
  const full = `${S.repo}/${f.path}`;
  const kind = conflictKind(f.xy);
  const op = S.status.operation;
  const ours = S.status.branch || t('detached');
  const theirs = op && op.name ? op.name : t('theirsShort');
  const head = h('div', { class: 'main-head' },
    statusBadge('U'), h('div', { class: 'main-title' }, h('b', { text: f.path }), h('small', { text: t(`ck_${kind}`) })), h('span', { class: 'spacer' }));
  const bar = h('div', { class: 'conflict-bar' },
    h('div', { class: 'conflict-help', text: t('conflictHelp') }),
    h('div', { class: 'conflict-actions' },
      h('button', { class: 'btn side-ours', onclick: () => act(() => g('resolveWith', f.path, 'ours')) }, icon('check', 15), t('takeOursNamed', { b: ours })),
      h('button', { class: 'btn side-theirs', onclick: () => act(() => g('resolveWith', f.path, 'theirs')) }, icon('check', 15), t('takeTheirsNamed', { b: theirs })),
      S.textline ? h('button', { class: 'btn', onclick: () => api.openInTextline(full) }, icon('textline', 15), t('openInTextline')) : h('button', { class: 'btn', onclick: () => api.openPath(full) }, icon('open', 15), t('openFile')),
      h('button', { class: 'btn primary', onclick: () => act(() => g('markResolved', f.path)) }, t('markResolved'))));
  const text = await api.readText(S.repo, f.path);
  const content = text == null ? emptyState('file', t('conflictNoText'), '') : h('div', { class: 'diff-view' }, h('div', { class: 'hunk' }, conflictView(text, f.path)));
  box.replaceChildren(head, bar, h('div', { class: 'main-scroll' }, content));
}

function modeSwitch() {
  const mode = S.settings.diffMode || 'split';
  const b = (m, ic, key) => h('button', { class: mode === m ? 'on' : '', title: t(key), onclick: () => {
    S.settings.diffMode = m;
    saveSettings();
    emit('render');
  } }, icon(ic, 15));
  return h('div', { class: 'seg mini' }, b('split', 'split', 'viewSplit'), b('unified', 'unified', 'viewUnified'));
}

export async function renderMain(box) {
  fixSelection();
  const token = ++diffToken;
  if (!S.status) return;
  if (!sel) {
    box.replaceChildren(emptyState('check', t('noChangesTitle'), t('noChangesText'),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: () => emit('tab', 'history') }, icon('history', 15), t('showHistory')))));
    return;
  }
  const f = findIn(sel.area, sel.path);
  if (sel.area === 'conflicted') return renderConflict(box, f);
  const staged = sel.area === 'staged';
  let file = null;
  let image = null;
  try {
    if (IMAGE_EXT.test(f.path) && f.status !== 'D') {
      const before = f.status === '?' || f.status === 'A' ? null : staged ? 'HEAD' : ':';
      const after = staged ? ':' : 'WORK';
      image = Promise.all([before ? api.image(S.repo, f.oldPath || f.path, before) : null, api.image(S.repo, f.path, after)]).then(([b, a]) => ({ before: b, after: a }));
    } else if (f.status === '?') {
      const u = await g('untrackedDiff', f.path);
      file = parseDiff(u.text)[0] || null;
      if (file && u.binary) file.binary = true;
    } else {
      file = parseDiff(await g('diffFile', f.path, { staged, oldFile: f.oldPath }))[0] || null;
    }
  } catch (e) {
    if (token !== diffToken) return;
    box.replaceChildren(emptyState('alert', t('diffFailed'), String(e.message || e)));
    return;
  }
  if (token !== diffToken) return;
  const added = file ? file.added : 0, removed = file ? file.removed : 0;
  const full = `${S.repo}/${f.path}`;
  const actions = h('div', { class: 'main-actions' });
  if (!staged) {
    actions.append(h('button', { class: 'btn ghost', title: t('discardTip'), onclick: () => discardFiles([f]) }, icon('undo', 15), t('discard')));
    actions.append(h('button', { class: 'btn primary', onclick: () => act(() => g('stage', [f.path])) }, icon('plus', 15), t('stageFile')));
  } else {
    actions.append(h('button', { class: 'btn', onclick: () => act(() => g('unstage', [f.path, ...(f.oldPath ? [f.oldPath] : [])])) }, icon('minus', 15), t('unstageFile')));
  }
  const more = h('button', { class: 'icon-btn menu-anchor', title: t('more'), onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    fileMenu({ preventDefault() {}, clientX: r.right - 200, clientY: r.bottom + 4 }, f, sel.area);
  } }, icon('more', 18));
  const head = h('div', { class: 'main-head' },
    statusBadge(f.status),
    h('div', { class: 'main-title' }, h('b', { text: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path }), h('small', {},
      h('span', { text: staged ? t('stagedTitle') : f.status === '?' ? t('stNew') : t('unstagedTitle') }),
      file && (added || removed) ? h('span', { class: 'stat-add', text: ` +${added}` }) : null,
      file && (added || removed) ? h('span', { class: 'stat-del', text: ` −${removed}` }) : null)),
    h('span', { class: 'spacer' }), image ? null : modeSwitch(), actions, more);
  const kind = f.status === '?' || f.status === 'D' || f.status === 'A' && !staged || (file && file.binary) ? 'readonly' : staged ? 'staged' : 'unstaged';
  const view = diffView({
    file, image, path: f.path, kind,
    onHunk: (action, i) => hunkAction(file, action, [i]),
    onLines: (action, i, lines) => lineAction(file, action, i, lines),
  });
  box.replaceChildren(head, h('div', { class: 'main-scroll' }, view));
  void full;
}

async function hunkAction(file, action, indices) {
  if (action === 'discard') {
    const r = await confirm(t('discardTitle'), t('discardHunkMsg'), [{ label: t('cancel'), value: 'cancel' }, { label: t('discard'), value: 'ok', danger: true, primary: true }]);
    if (r !== 'ok') return;
  }
  await act(async () => {
    if (action === 'stage') await g('applyPatch', buildPatch(file, indices), { cached: true });
    else if (action === 'unstage') await g('applyPatch', buildPatch(file, indices, { reverse: true }), { cached: true, reverse: true });
    else await g('applyPatch', buildPatch(file, indices, { reverse: true }), { cached: false, reverse: true });
  }, { title: t('hunkFailed') });
}

async function lineAction(file, action, hunk, lines) {
  await act(async () => {
    if (action === 'stage') await g('applyPatch', buildLinePatch(file, hunk, lines), { cached: true });
    else await g('applyPatch', buildLinePatch(file, hunk, lines, { reverse: true }), { cached: true, reverse: true });
  }, { title: t('hunkFailed') });
}

export function resetDraft() {
  draft = { summary: '', body: '', amend: false, coAuthors: [] };
}
export function setDraft(d) {
  Object.assign(draft, d);
}
export { openIgnore, showError, dialog, baseName };
