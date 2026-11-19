// Verlauf: Commit-Liste mit Branch-Grafik, Suche, Datei-Verlauf und Commit-Details.
import { h, showMenu, confirm, prompt, toast } from './ui.js';
import { icon } from './icons.js';
import { S, t, g, api, act, emit, relTime, fmtDate, avatar, statusBadge, pathLabel, emptyState, copyText, saveSettings } from './common.js';
import { diffView, IMAGE_EXT } from './diffview.js';
import { parseDiff } from '../../shared/diff.js';
import { layout } from '../../shared/graph.js';
import { LANES } from './theme.js';

const PAGE = 300;
const ROW = 46;
const LANE = 12;
const MAXL = 10;

const H = {
  commits: [],
  graph: null,
  selected: null,
  query: '',
  file: null,
  ref: null,
  more: false,
  loading: false,
  key: '',
  searchMode: false,
};
export const historyState = () => H;

const opts = () => ({ all: !!S.settings.allBranches && !H.file && !H.ref, ref: H.ref, file: H.file });

export async function loadHistory(reset = true) {
  if (!S.repo || H.loading) return;
  H.loading = true;
  try {
    const o = opts();
    if (H.query.trim()) {
      H.searchMode = true;
      H.commits = await g('search', H.query, { all: true, max: PAGE });
      H.more = false;
    } else {
      H.searchMode = false;
      const list = await g('log', { ...o, skip: reset ? 0 : H.commits.length, max: PAGE });
      H.commits = reset ? list : [...H.commits, ...list];
      H.more = list.length === PAGE;
    }
    H.graph = H.searchMode || H.file ? null : layout(H.commits);
    if (!H.selected || !H.commits.some((c) => c.hash === H.selected)) H.selected = H.commits[0] ? H.commits[0].hash : null;
  } finally {
    H.loading = false;
  }
}

export function showFileHistory(file) {
  H.file = file;
  H.ref = null;
  H.query = '';
  H.selected = null;
  H.key = '';
}
export function showRef(ref, hash) {
  H.ref = ref;
  H.file = null;
  H.query = '';
  H.selected = hash || null;
  H.key = '';
}
export function selectCommit(hash) {
  H.selected = hash;
}

// ---------------------------------------------------------------- Grafik
function graphSvg(row, width) {
  const w = Math.min(width, MAXL) * LANE + 8;
  const x = (c) => 8 + Math.min(c, MAXL) * LANE;
  const mid = ROW / 2;
  let paths = '';
  const col = (i) => LANES[i % LANES.length];
  for (const e of row.up) {
    const a = x(e.from), b = x(e.to);
    paths += `<path d="${a === b ? `M${a} 0V${mid}` : `M${a} 0C${a} ${mid * 0.55} ${b} ${mid * 0.45} ${b} ${mid}`}" stroke="${col(e.color)}"/>`;
  }
  for (const e of row.down) {
    const a = x(e.from), b = x(e.to);
    paths += `<path d="${a === b ? `M${a} ${mid}V${ROW}` : `M${a} ${mid}C${a} ${mid + mid * 0.55} ${b} ${mid + mid * 0.45} ${b} ${ROW}`}" stroke="${col(e.color)}"/>`;
  }
  const cx = x(row.col);
  const c = col(row.color);
  const dot = row.merge ? `<circle cx="${cx}" cy="${mid}" r="4.2" fill="var(--panel)" stroke="${c}" stroke-width="2.2"/>` : `<circle cx="${cx}" cy="${mid}" r="4.4" fill="${c}" stroke="var(--panel)" stroke-width="1.5"/>`;
  return `<svg class="graph" width="${w}" height="${ROW}" viewBox="0 0 ${w} ${ROW}" fill="none" stroke-width="2" stroke-linecap="round">${paths}${dot}</svg>`;
}

export function refPills(refs, limit = 4) {
  const out = [];
  for (const r of refs.filter((x) => x.type !== 'head').slice(0, limit)) {
    out.push(h('span', { class: `ref ref-${r.type}${r.current ? ' current' : ''}`, title: r.name }, icon(r.type === 'tag' ? 'tag' : r.type === 'remote' ? 'cloud' : 'branch', 11), h('span', { text: r.name })));
  }
  return out;
}

// ---------------------------------------------------------------- Seitenleiste
export function renderSide(box) {
  const search = h('input', { class: 'input search-input', placeholder: t('searchPh'), value: H.query, spellcheck: 'false' });
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      H.query = search.value;
      await loadHistory();
      emit('render');
      const s = document.querySelector('.search-input');
      if (s) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    }, 250);
  });
  const filters = h('div', { class: 'hist-filters' });
  if (H.file) filters.append(h('span', { class: 'filter-pill' }, icon('file', 12), h('span', { text: H.file }), h('button', { class: 'x', title: t('remove'), onclick: async () => { H.file = null; await loadHistory(); emit('render'); } }, icon('close', 12))));
  else if (H.ref) filters.append(h('span', { class: 'filter-pill' }, icon('branch', 12), h('span', { text: H.ref }), h('button', { class: 'x', title: t('remove'), onclick: async () => { H.ref = null; await loadHistory(); emit('render'); } }, icon('close', 12))));
  else filters.append(h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!S.settings.allBranches, onchange: async (e) => {
    S.settings.allBranches = e.target.checked;
    saveSettings();
    await loadHistory();
    emit('render');
  } }), t('allBranches')));
  filters.append(h('span', { class: 'spacer' }), h('span', { class: 'muted small', text: H.searchMode ? t('hits', { n: H.commits.length }) : '' }));
  const list = h('div', { class: 'side-scroll commit-list' });
  const width = H.graph ? H.graph.width : 0;
  H.commits.forEach((c, i) => {
    const row = H.graph ? H.graph.rows[i] : null;
    const el = h('div', {
      class: `row commit${c.hash === H.selected ? ' on' : ''}`, 'data-hash': c.hash,
      onclick: () => {
        H.selected = c.hash;
        emit('render');
      },
      oncontextmenu: (e) => commitMenu(e, c),
    });
    if (row) el.append(h('span', { class: 'graph-cell', html: graphSvg(row, width) }));
    el.append(h('div', { class: 'commit-text' },
      h('div', { class: 'commit-subject' }, ...refPills(c.refs), h('span', { class: 'subj', text: c.subject || t('noMessage') })),
      h('div', { class: 'commit-meta' }, h('span', { text: c.author }), h('span', { text: '·' }), h('span', { text: relTime(c.time), title: fmtDate(c.time) }), h('span', { class: 'spacer' }), h('code', { text: c.short }))));
    list.append(el);
  });
  if (!H.commits.length) list.append(h('div', { class: 'side-empty' }, icon(H.query ? 'search' : 'history', 22), h('span', { text: H.query ? t('noHits') : t('noCommits') })));
  if (H.more) {
    const more = h('div', { class: 'load-more', text: t('loading') });
    list.append(more);
    const io = new IntersectionObserver(async (es) => {
      if (!es.some((e) => e.isIntersecting) || H.loading) return;
      io.disconnect();
      const top = list.scrollTop;
      await loadHistory(false);
      emit('render');
      const nl = document.querySelector('.commit-list');
      if (nl) nl.scrollTop = top;
    }, { root: list });
    io.observe(more);
  }
  box.replaceChildren(h('div', { class: 'side-tools' }, h('div', { class: 'search-box' }, icon('search', 15), search), filters), list);
  const on = list.querySelector('.row.on');
  if (on && H.key !== H.selected) {
    H.key = H.selected;
    requestAnimationFrame(() => on.scrollIntoView({ block: 'nearest' }));
  }
}

function commitMenu(e, c) {
  e.preventDefault();
  const head = S.status && S.status.branch;
  showMenu([
    { label: t('copyHash'), run: () => copyText(c.hash) },
    { label: t('copySubject'), run: () => copyText(c.subject) },
    '-',
    { label: t('branchHere'), run: () => emit('new-branch', c.hash) },
    { label: t('tagHere'), run: () => emit('new-tag', c.hash) },
    { label: t('checkoutCommit'), run: () => checkoutCommit(c) },
    '-',
    { label: t('cherryPick', { b: head || 'HEAD' }), disabled: !head, run: () => cherry(c) },
    { label: t('revertCommit'), run: () => revertCommit(c) },
    { label: t('resetTo'), submenu: [
      { label: t('resetSoft'), run: () => resetTo(c, 'soft') },
      { label: t('resetMixed'), run: () => resetTo(c, 'mixed') },
      { label: t('resetHard'), run: () => resetTo(c, 'hard') },
    ] },
  ], e.clientX, e.clientY);
}

async function checkoutCommit(c) {
  const r = await confirm(t('checkoutCommitTitle'), t('checkoutCommitMsg', { h: c.short }), [{ label: t('cancel'), value: 'cancel' }, { label: t('checkout'), value: 'ok', primary: true }]);
  if (r === 'ok') await act(() => g('checkoutCommit', c.hash));
}
async function cherry(c) {
  const r = await act(() => g('cherryPick', c.hash));
  if (r && r.conflict) {
    toast(t('conflictsFound'), { kind: 'error' });
    emit('tab', 'changes');
  } else if (r) toast(t('cherryDone', { h: c.short }));
}
async function revertCommit(c) {
  const r = await confirm(t('revertTitle'), t('revertMsg', { s: c.subject }), [{ label: t('cancel'), value: 'cancel' }, { label: t('revertGo'), value: 'ok', primary: true }]);
  if (r !== 'ok') return;
  const x = await act(() => g('revert', c.hash));
  if (x && x.conflict) {
    toast(t('conflictsFound'), { kind: 'error' });
    emit('tab', 'changes');
  }
}
async function resetTo(c, mode) {
  const r = await confirm(t('resetTitle'), t(`reset_${mode}_msg`, { h: c.short }), [{ label: t('cancel'), value: 'cancel' }, { label: t('resetGo'), value: 'ok', primary: true, danger: mode === 'hard' }]);
  if (r === 'ok') await act(() => g('resetTo', c.hash, mode));
}

// ---------------------------------------------------------------- Details
let detailToken = 0;

/** Dateiliste links, Diff rechts; für Commits und Stashes */
export function filesAndDiff(files, loadDiff, imageRevs, { state = {} } = {}) {
  const wrap = h('div', { class: 'files-diff' });
  const list = h('div', { class: 'cfiles' });
  const pane = h('div', { class: 'cdiff' });
  if (!state.file || !files.some((f) => f.path === state.file)) state.file = files[0] ? files[0].path : null;
  let token = 0;
  const show = async () => {
    const my = ++token;
    list.querySelectorAll('.row').forEach((r) => r.classList.toggle('on', r.dataset.path === state.file));
    const f = files.find((x) => x.path === state.file);
    if (!f) {
      pane.replaceChildren(emptyState('file', t('noFiles'), ''));
      return;
    }
    pane.replaceChildren(h('div', { class: 'loading', text: t('loading') }));
    let view;
    try {
      if (IMAGE_EXT.test(f.path) && imageRevs) {
        const [b, a] = imageRevs(f);
        view = diffView({ image: Promise.all([b ? api.image(S.repo, f.oldPath || f.path, b) : null, a ? api.image(S.repo, f.path, a) : null]).then(([before, after]) => ({ before, after })) });
      } else {
        const file = parseDiff(await loadDiff(f))[0] || null;
        view = diffView({ file, path: f.path, kind: 'readonly' });
      }
    } catch (e) {
      view = emptyState('alert', t('diffFailed'), String(e.message || e));
    }
    if (my !== token) return;
    pane.replaceChildren(view);
  };
  for (const f of files) {
    list.append(h('div', { class: 'row file', 'data-path': f.path, onclick: () => { state.file = f.path; show(); }, oncontextmenu: (e) => {
      e.preventDefault();
      showMenu([{ label: t('copyPath'), run: () => copyText(f.path) }, { label: t('fileHistory'), run: () => emit('file-history', f.path) }, { label: t('showInFolder'), run: () => api.reveal(`${S.repo}/${f.path}`) }], e.clientX, e.clientY);
    } },
    statusBadge(f.status), pathLabel(f.path, f.oldPath),
    f.added != null || f.removed != null ? h('span', { class: 'num' }, f.added ? h('span', { class: 'stat-add', text: `+${f.added}` }) : null, f.removed ? h('span', { class: 'stat-del', text: `−${f.removed}` }) : null) : null));
  }
  wrap.append(list, pane);
  show();
  return wrap;
}

const fileState = {};
export async function commitDetails(hash, { actions = null } = {}) {
  const c = await g('commitInfo', hash);
  const parent = c.parents[0] || null;
  const head = h('div', { class: 'commit-card' },
    h('div', { class: 'cc-top' },
      avatar(c.author, 36),
      h('div', { class: 'cc-who' },
        h('b', { text: c.author }), h('small', { text: `${c.email} · ${fmtDate(c.time)}` }),
        c.committer && c.committer !== c.author ? h('small', { text: t('committedBy', { n: c.committer }) }) : null),
      h('span', { class: 'spacer' }),
      actions,
      h('button', { class: 'hash-btn', title: t('copyHash'), onclick: () => { copyText(c.hash); toast(t('copied')); } }, icon('copy', 13), h('code', { text: c.short }))),
    h('h2', { class: 'cc-subject', text: c.subject || t('noMessage') }),
    c.body ? h('pre', { class: 'cc-body', text: c.body }) : null,
    h('div', { class: 'cc-meta' },
      ...refPills(c.refs, 12),
      c.coAuthors.length ? h('span', { class: 'co' }, icon('users', 13), c.coAuthors.map((x) => x.name).join(', ')) : null,
      c.parents.length ? h('span', { class: 'parents' }, t(c.parents.length > 1 ? 'mergeOf' : 'parent'), ' ', ...c.parents.map((p) => h('a', { class: 'link mono', text: p.slice(0, 7), onclick: () => { H.selected = p; H.key = ''; emit('render'); } }))) : h('span', { class: 'muted', text: t('rootCommit') }),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted', text: t('filesChanged', { n: c.files.length }) })));
  const body = filesAndDiff(c.files, (f) => g('commitDiff', c.hash, f.path, parent), (f) => [f.status === 'A' ? null : parent, f.status === 'D' ? null : c.hash], { state: fileState });
  return h('div', { class: 'details' }, head, body);
}

export async function renderMain(box) {
  const my = ++detailToken;
  if (!H.selected) {
    box.replaceChildren(emptyState('history', t('noCommits'), t('noCommitsText')));
    return;
  }
  try {
    const el = await commitDetails(H.selected);
    if (my !== detailToken) return;
    box.replaceChildren(el);
  } catch (e) {
    if (my !== detailToken) return;
    box.replaceChildren(emptyState('alert', t('loadFailed'), String(e.message || e)));
  }
}

export { prompt };
