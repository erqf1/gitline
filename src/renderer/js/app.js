// Gitline - Oberfläche: Kopfleiste, Startseite, Tabs links, Inhalt rechts.
import { h, $, showMenu, confirm, toast, dialog } from './ui.js';
import { applyTheme, ACCENTS } from './theme.js';
import { icon, logoSvg } from './icons.js';
import i18n from '../../shared/i18n.js';
import { S, t, g, api, on, emit, act, baseName, showError, saveSettings, emptyState, relTime } from './common.js';
import * as changes from './changes.js';
import * as history from './history.js';
import * as branches from './branches.js';
import * as stash from './stash.js';
import * as tags from './tags.js';
import { fetchAll, pull, push, cancelOp, remoteOp, remoteBusy } from './sync.js';
import { cloneDialog, initDialog, createRepo, settingsDialog, openIgnore, remoteDialog } from './dialogs.js';

const TABS = [
  ['changes', 'changes', 'tabChanges', changes],
  ['history', 'history', 'tabHistory', history],
  ['branches', 'branch', 'tabBranches', branches],
  ['stash', 'stash', 'tabStash', stash],
  ['tags', 'tag', 'tabTags', tags],
];
const GIT_DOWNLOAD = 'https://git-scm.com/downloads';
let lastHead = null;
let refreshing = null;
let refreshAgain = false;

// ---------------------------------------------------------------- Einstellungen
function withDefaults(s) {
  const out = { ...s };
  out.language ||= i18n.LANGS.map(([c]) => c).find((c) => navigator.language.toLowerCase().startsWith(c)) || 'en';
  out.mode ||= 'system';
  out.look ||= 'standard';
  if (!ACCENTS.includes(out.accent)) out.accent = ACCENTS[0];
  out.diffMode ||= 'split';
  out.pullMode ||= 'merge';
  out.autoFetch ??= true;
  out.allBranches ??= true;
  out.sideWidth ||= 340;
  out.recent = Array.isArray(out.recent) ? out.recent.filter((r) => r && r.path).slice(0, 15) : [];
  return out;
}
function theme() {
  const dark = S.settings.mode === 'dark' || (S.settings.mode === 'system' && S.info.dark);
  applyTheme(S.settings.accent, dark, S.settings.look);
}

// ---------------------------------------------------------------- Repository öffnen
function remember(dir) {
  S.settings.recent = [{ path: dir, name: baseName(dir), time: Math.floor(Date.now() / 1000) }, ...S.settings.recent.filter((r) => r.path !== dir)].slice(0, 15);
  S.settings.last = dir;
  saveSettings();
}

export async function openRepo(dir, { quiet = false } = {}) {
  if (!dir) return false;
  const top = await api.git('topLevel', dir);
  if (!top) {
    if (quiet) return false;
    const r = await confirm(t('notRepoTitle'), t('notRepoMsg', { d: dir }), [{ label: t('cancel'), value: 'cancel' }, { label: t('initHere'), value: 'init', primary: true }]);
    if (r !== 'init') return false;
    try {
      await api.git('init', dir, S.settings.defaultBranch || 'main');
    } catch (e) {
      await showError(e);
      return false;
    }
    return openRepo(dir);
  }
  S.repo = top;
  S.status = null;
  lastHead = null;
  history.showRef(null);
  S.tab = S.tab || 'changes';
  changes.resetDraft();
  remember(top);
  api.watch(top);
  api.setTitle(`${baseName(top)} – Gitline`);
  buildWorkspace();
  await refresh();
  if (S.settings.autoFetch && !S.info.selfTest) fetchAll({ quiet: true });
  return true;
}

function closeRepo() {
  S.repo = null;
  S.status = null;
  api.watch(null);
  api.setTitle('Gitline');
  S.settings.last = null;
  saveSettings();
  buildWelcome();
}

async function pickAndOpen() {
  const dir = await api.pickFolder({ title: t('openRepo') });
  if (dir) await openRepo(dir);
}

async function doClone(prefill) {
  const r = await cloneDialog(prefill);
  if (!r) return;
  try {
    await remoteOp('clone', t('cloning'), r.url, r.dir);
  } catch (e) {
    await showError(e, t('cloneFailed'));
    return;
  }
  if (await api.exists(r.dir)) await openRepo(r.dir);
}

async function doInit() {
  const r = await initDialog();
  if (!r) return;
  try {
    const { repo, files } = await createRepo(r);
    await openRepo(repo);
    if (files) {
      changes.setDraft({ summary: t('firstCommit') });
      emit('render');
    }
  } catch (e) {
    await showError(e);
  }
}

// ---------------------------------------------------------------- Laden
export async function refresh() {
  if (!S.repo) return;
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const [st, refs, st2] = await Promise.all([g('status'), g('refs'), g('stashes')]);
      S.status = st;
      S.refs = refs;
      S.stashes = st2;
      const head = `${st.oid}|${st.branch}|${refs.local.length}|${refs.remote.length}|${refs.tags.length}`;
      if (head !== lastHead || S.tab === 'history') {
        lastHead = head;
        await history.loadHistory();
      }
    } catch (e) {
      // Ordner weg oder kein Repository mehr
      if (!(await api.exists(S.repo))) {
        toast(t('repoGone'), { kind: 'error' });
        closeRepo();
        return;
      }
      console.warn(e);
    }
  })();
  await refreshing;
  refreshing = null;
  if (refreshAgain) {
    refreshAgain = false;
    return refresh();
  }
  render();
}

// ---------------------------------------------------------------- Aufbau
function topbar() {
  const bar = h('div', { id: 'topbar' }, h('div', { class: 'brand' }, h('span', { html: logoSvg(26), style: { display: 'block', height: '26px' } }), 'Gitline'));
  if (S.repo) {
    bar.append(h('div', { class: 'tb-sep' }),
      h('button', { id: 'repo-btn', class: 'tb-btn menu-anchor', onclick: (e) => repoMenu(e.currentTarget) }, icon('folder', 16), h('span', { class: 'tb-text' }, h('small', { text: t('repository') }), h('b', { id: 'repo-name', text: baseName(S.repo) })), icon('down', 14)),
      h('button', { id: 'branch-btn', class: 'tb-btn menu-anchor', onclick: (e) => branchMenu(e.currentTarget) }, icon('branch', 16), h('span', { class: 'tb-text' }, h('small', { text: t('currentBranch') }), h('b', { id: 'branch-name' })), icon('down', 14)),
      h('div', { class: 'spacer' }),
      h('div', { id: 'op', class: 'op hidden' }),
      h('div', { id: 'sync', class: 'sync' }));
  } else bar.append(h('div', { class: 'spacer' }));
  bar.append(h('button', { class: 'icon-btn', id: 'settings-btn', title: t('settings'), onclick: settingsDialog }, icon('settings', 18)));
  bar.append(h('div', { id: 'progress', class: 'progress' }, h('i')));
  return bar;
}

function buildWelcome() {
  const gitOk = S.info.git && S.info.git.ok;
  const recent = S.settings.recent;
  const card = h('div', { class: 'welcome' },
    h('div', { class: 'w-logo', html: logoSvg(76) }),
    h('h1', { text: t('welcomeTitle') }),
    h('p', { class: 'w-sub', text: t('welcomeSub') }));
  if (!gitOk) {
    card.append(h('div', { class: 'git-missing' }, icon('alert', 20), h('div', {}, h('b', { text: t('gitMissingTitle') }), h('p', { text: t(`gitMissing_${S.info.platform === 'darwin' ? 'mac' : S.info.platform === 'win32' ? 'win' : 'linux'}`) }),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: () => api.openExternal(GIT_DOWNLOAD) }, icon('open', 15), t('gitDownload')),
        h('button', { class: 'btn', onclick: async () => {
          S.info.git = await api.detectGit();
          if (S.info.git.ok) toast(t('gitFound', { v: S.info.git.version }));
          buildWelcome();
        } }, icon('fetch', 15), t('checkAgain'))))));
  }
  const big = (ic, title, text, fn, id) => h('button', { class: 'w-action', id, disabled: !gitOk, onclick: fn }, h('span', { class: 'w-ic' }, icon(ic, 22)), h('b', { text: title }), h('small', { text }));
  card.append(h('div', { class: 'w-actions' },
    big('folder', t('openRepo'), t('openRepoText'), pickAndOpen, 'w-open'),
    big('clone', t('cloneRepo'), t('cloneRepoText'), () => doClone(), 'w-clone'),
    big('newRepo', t('newRepo'), t('newRepoText'), doInit, 'w-new')));
  if (recent.length) {
    card.append(h('div', { class: 'w-recent' }, h('div', { class: 'sect-title', text: t('recentRepos') }),
      recent.slice(0, 8).map((r) => h('button', { class: 'w-repo', disabled: !gitOk, onclick: () => openRepo(r.path), oncontextmenu: (e) => {
        e.preventDefault();
        showMenu([{ label: t('removeFromList'), run: () => { S.settings.recent = S.settings.recent.filter((x) => x.path !== r.path); saveSettings(); buildWelcome(); } }], e.clientX, e.clientY);
      } }, icon('folder', 16), h('span', { class: 'w-repo-name', text: r.name }), h('span', { class: 'w-repo-path', text: r.path }), h('span', { class: 'muted small', text: r.time ? relTime(r.time) : '' })))));
  }
  $('#app').replaceChildren(topbar(), h('div', { id: 'welcome-wrap' }, card));
}

function buildWorkspace() {
  const tabs = h('div', { class: 'tabs', id: 'tabs' }, TABS.map(([id, ic, key]) => h('button', { class: `tab${S.tab === id ? ' on' : ''}`, 'data-tab': id, title: t(key), onclick: () => setTab(id) }, icon(ic, 17), h('span', { text: t(key) }), h('span', { class: 'count hidden' }))));
  const side = h('div', { id: 'side', style: { width: `${S.settings.sideWidth}px` } }, tabs, h('div', { id: 'side-body' }));
  const splitter = h('div', { id: 'splitter', title: '' });
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = e.clientX, w0 = side.offsetWidth;
    const move = (ev) => {
      const w = Math.max(260, Math.min(window.innerWidth - 420, w0 + ev.clientX - start));
      side.style.width = `${w}px`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      S.settings.sideWidth = side.offsetWidth;
      saveSettings();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  $('#app').replaceChildren(topbar(), h('div', { id: 'banner', class: 'hidden' }), h('div', { id: 'workspace' }, side, splitter, h('div', { id: 'main' })));
}

async function setTab(id) {
  if (S.tab === id) return;
  S.tab = id;
  if (id === 'history') await history.loadHistory();
  render();
}

// ---------------------------------------------------------------- Zeichnen
function renderTopbar() {
  const st = S.status;
  if (!st) return;
  const name = $('#branch-name');
  if (name) name.textContent = st.branch || (st.oid ? `${t('detached')} ${st.oid.slice(0, 7)}` : t('noCommitsYet'));
  const sync = $('#sync');
  if (!sync) return;
  const busy = remoteBusy();
  const hasRemote = st.remotes.length > 0;
  const btn = (id, ic, label, tip, fn, badge, primary) => h('button', { id, class: `btn sync-btn${primary ? ' primary' : ''}`, title: tip, disabled: busy || !!S.busy, onclick: fn }, icon(ic, 16), h('span', { text: label }), badge ? h('span', { class: 'badge', text: badge }) : null);
  const list = [btn('fetch-btn', 'fetch', t('fetch'), t('fetchTip'), () => fetchAll())];
  if (!hasRemote) list.push(btn('remote-btn', 'link', t('remoteAdd'), t('remoteAddTip'), () => remoteDialog()));
  else if (!st.upstream && st.branch) list.push(btn('push-btn', 'push', t('publishBranch'), t('publishTip'), () => push(), null, true));
  else {
    list.push(btn('pull-btn', 'pull', t('pull'), t('pullTip'), () => pull(), st.behind ? `↓${st.behind}` : null, st.behind > 0));
    list.push(btn('push-btn', 'push', t('push'), t('pushTip'), () => push(), st.ahead ? `↑${st.ahead}` : null, st.ahead > 0 && !st.behind));
  }
  sync.replaceChildren(...list);
  renderProgress();
}

function renderProgress() {
  const op = $('#op');
  const bar = $('#progress');
  if (!op || !bar) return;
  if (!S.op) {
    op.classList.add('hidden');
    bar.classList.remove('on');
    return;
  }
  const pct = Math.round((S.op.ratio || 0) * 100);
  op.classList.remove('hidden');
  op.replaceChildren(h('span', { class: 'spin' }), h('span', { class: 'op-text', title: S.op.text || '', text: `${S.op.label}${pct ? ` ${pct} %` : ''}` }),
    h('button', { class: 'icon-btn small', title: t('cancel'), onclick: cancelOp }, icon('close', 14)));
  bar.classList.add('on');
  bar.firstChild.style.transform = `scaleX(${Math.max(0.03, S.op.ratio || 0)})`;
  api.setProgress(S.op.ratio || 0.02);
}

function renderBanner() {
  const el = $('#banner');
  if (!el || !S.status) return;
  const st = S.status;
  const op = st.operation;
  const parts = [];
  if (op) {
    const n = st.conflicted.length;
    const what = t(`op_${op.kind}`, { b: op.name || '…' });
    parts.push(icon(n ? 'conflict' : 'merge', 18), h('div', { class: 'b-text' }, h('b', { text: what }), h('span', { text: n ? t('conflictsLeft', { n }) : t('conflictsSolved') })), h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: async () => {
        const r = await confirm(t('abortTitle'), t('abortMsg'), [{ label: t('cancel'), value: 'cancel' }, { label: t('abortGo'), value: 'ok', danger: true, primary: true }]);
        if (r === 'ok') await act(() => g('abortOperation', op.kind));
      } }, t('abortGo')),
      h('button', { class: 'btn primary', disabled: n > 0, onclick: async () => {
        try {
          await g('continueOperation', op.kind);
          toast(t('opFinished'));
        } catch (e) {
          await showError(e);
        }
        emit('refresh');
      } }, op.kind === 'merge' ? t('finishMerge') : t('continueGo')));
    el.className = `banner ${n ? 'warn' : 'ok'}`;
  } else if (st.detached && st.oid) {
    parts.push(icon('info', 18), h('div', { class: 'b-text' }, h('b', { text: t('detachedTitle') }), h('span', { text: t('detachedText') })), h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => branches.newBranchDialog() }, t('newBranch')));
    el.className = 'banner info';
  } else {
    el.className = 'hidden';
  }
  el.replaceChildren(...parts);
}

function renderTabs() {
  const counts = { changes: changes.changeCount(), stash: S.stashes.length, branches: 0, history: 0, tags: 0 };
  document.querySelectorAll('#tabs .tab').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === S.tab);
    const c = b.querySelector('.count');
    const n = counts[b.dataset.tab];
    c.textContent = n > 999 ? '999+' : String(n);
    c.classList.toggle('hidden', !n);
  });
}

export function render() {
  if (!S.repo || !S.status || !$('#side-body')) return;
  renderTopbar();
  renderBanner();
  renderTabs();
  const mod = TABS.find(([id]) => id === S.tab)[3];
  const side = $('#side-body');
  const keepScroll = side.querySelector('.side-scroll');
  const top = keepScroll ? keepScroll.scrollTop : 0;
  const sameTab = side.dataset.tab === S.tab;
  side.dataset.tab = S.tab;
  mod.renderSide(side);
  const ns = side.querySelector('.side-scroll');
  if (ns && sameTab) ns.scrollTop = top;
  const main = $('#main');
  main.dataset.tab = S.tab;
  mod.renderMain(main);
}

// ---------------------------------------------------------------- Menüs der Kopfleiste
function repoMenu(btn) {
  const r = btn.getBoundingClientRect();
  btn.classList.add('open');
  const others = S.settings.recent.filter((x) => x.path !== S.repo).slice(0, 8);
  showMenu([
    { header: t('recentRepos') },
    ...(others.length ? others.map((x) => ({ label: x.name, shortcut: '', run: () => openRepo(x.path) })) : [{ label: t('none'), disabled: true }]),
    '-',
    { label: t('openRepo'), shortcut: 'Ctrl+O', run: pickAndOpen },
    { label: t('cloneRepo'), run: () => doClone() },
    { label: t('newRepo'), run: doInit },
    '-',
    { label: t('showInFolder'), run: () => api.openPath(S.repo) },
    { label: t('remoteSettings'), run: remoteDialog },
    { label: t('ignoreTitle'), run: openIgnore },
    '-',
    { label: t('closeRepo'), run: closeRepo },
  ], r.left, r.bottom + 4);
}

function branchMenu(btn) {
  const r = btn.getBoundingClientRect();
  btn.classList.add('open');
  const locals = S.refs.local.slice(0, 12);
  showMenu([
    { header: t('localBranches') },
    ...locals.map((b) => ({ label: b.name, checked: b.current, run: () => !b.current && branches.switchTo(b.name) })),
    ...(locals.length ? [] : [{ label: t('noBranchesYet'), disabled: true }]),
    '-',
    { label: t('newBranch'), shortcut: 'Ctrl+B', run: () => branches.newBranchDialog() },
    { label: t('allBranchesMenu'), run: () => setTab('branches') },
  ], r.left, r.bottom + 4);
}

// ---------------------------------------------------------------- Ereignisse
on('render', render);
on('refresh', () => refresh());
on('busy', renderTopbar);
on('progress', renderProgress);
on('theme', theme);
on('language', () => {
  document.documentElement.lang = S.settings.language;
  if (S.repo) {
    buildWorkspace();
    render();
  } else buildWelcome();
});
on('tab', (id) => setTab(id));
on('committed', () => refresh());
on('file-history', async (file) => {
  history.showFileHistory(file);
  S.tab = 'history';
  await history.loadHistory();
  render();
});
on('ref-history', async (ref, hash) => {
  history.showRef(ref, hash);
  S.tab = 'history';
  await history.loadHistory();
  if (hash) history.selectCommit(hash);
  render();
});
on('new-branch', (from) => branches.newBranchDialog(from));
on('new-tag', (target) => tags.newTagDialog(target));

function keys(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (document.querySelector('.overlay')) return;
  const k = e.key.toLowerCase();
  if (mod && k === 'o') {
    e.preventDefault();
    pickAndOpen();
  } else if (!S.repo) {
    // nur Öffnen geht auf der Startseite
  } else if (mod && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    setTab(TABS[+e.key - 1][0]);
  } else if (e.key === 'F5' || (mod && k === 'r')) {
    e.preventDefault();
    refresh();
  } else if (mod && k === 'b') {
    e.preventDefault();
    branches.newBranchDialog();
  } else if (mod && e.shiftKey && k === 'p') {
    e.preventDefault();
    pull();
  } else if (mod && k === 'p') {
    e.preventDefault();
    push();
  }
}

async function main() {
  S.info = await api.info();
  S.settings = withDefaults(await api.getSettings());
  saveSettings();
  theme();
  document.documentElement.lang = S.settings.language;
  S.textline = await api.textlineAvailable();
  document.addEventListener('keydown', keys);
  api.onSystemTheme((dark) => {
    S.info.dark = dark;
    theme();
  });
  api.onFocus(() => S.repo && refresh());
  let ignoreUntil = 0;
  api.onRepoChanged(() => {
    if (S.repo && !S.busy && Date.now() > ignoreUntil) {
      ignoreUntil = Date.now() + 800;
      refresh();
    }
  });
  api.onOpenFolder((dir) => openRepo(dir));
  api.onClosing(async (o) => {
    if (remoteBusy()) {
      const r = await confirm(t('closeTitle'), t('closeMsg'), [{ label: t('cancel'), value: 'cancel' }, { label: t('closeAnyway'), value: 'close', danger: true }]);
      if (r !== 'close') return;
      cancelOp();
    }
    if (o && o.update) api.updateReady();
    else api.closeNow();
  });
  // Neue Commits auf dem Server alle 10 Minuten nachschauen (wenn eingeschaltet)
  setInterval(() => {
    if (S.repo && S.settings.autoFetch && !S.op && !S.busy && document.hasFocus()) fetchAll({ quiet: true });
  }, 10 * 60 * 1000);
  buildWelcome();
  if (S.info.git && S.info.git.ok && !S.info.selfTest) {
    const dir = (await api.initialFolder()) || S.settings.last;
    if (dir && (await api.exists(dir))) await openRepo(dir, { quiet: !!S.settings.last && dir === S.settings.last });
  }
  if (S.info.selfTest) {
    window.__gl = {
      S, t, openRepo, refresh, render, setTab, closeRepo, emit,
      changes, history, branches, stash, tags,
      buildWelcome,
      settingsDialog,
      set: (next) => {
        Object.assign(S.settings, next);
        theme();
      },
      idle: () => !refreshing && !S.busy && !S.op,
    };
  }
}

void dialog;
void emptyState;
main();
