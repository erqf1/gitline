// Dialoge: Klonen, neues Repository, .gitignore, Git-Identität, Co-Autoren, Remote, Einstellungen.
import { h, dialog, toast } from './ui.js';
import { icon } from './icons.js';
import { S, t, g, api, act, emit, saveSettings, showError, baseName } from './common.js';
import { TEMPLATES, addLines, patternFor } from '../../shared/ignore.js';
import { ACCENTS } from './theme.js';
import i18n from '../../shared/i18n.js';

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { text: label }), input, hint ? h('small', { class: 'hint', text: hint }) : null);
const input = (attrs = {}) => h('input', { class: 'input', spellcheck: 'false', ...attrs });

/** Name eines Repositorys aus der URL: https://host/user/projekt.git -> projekt */
export function repoNameFromUrl(url) {
  const s = String(url || '').trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  const m = /[/:]([^/:]+)$/.exec(s);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------- Klonen
export async function cloneDialog(prefill = '') {
  const url = input({ placeholder: 'https://github.com/name/projekt.git', value: prefill });
  const parent = input({ value: S.settings.cloneDir || S.info.documents || S.info.home });
  const name = input({ value: repoNameFromUrl(prefill) });
  let nameTouched = false;
  name.addEventListener('input', () => { nameTouched = true; });
  url.addEventListener('input', () => {
    if (!nameTouched) name.value = repoNameFromUrl(url.value);
  });
  const pick = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const dir = await api.pickFolder({ title: t('cloneWhere'), defaultPath: parent.value });
    if (dir) parent.value = dir;
  } }, icon('folder', 15));
  const err = h('p', { class: 'form-error' });
  const body = h('div', { class: 'form' },
    field(t('cloneUrl'), url, t('cloneUrlHint')),
    h('label', { class: 'field' }, h('span', { text: t('cloneWhere') }), h('div', { class: 'input-row' }, parent, pick)),
    field(t('cloneName'), name),
    h('p', { class: 'hint', text: t('authNote') }),
    err);
  for (;;) {
    const r = await dialog({ title: t('cloneTitle'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('cloneGo'), value: 'ok', primary: true }] });
    if (r !== 'ok') return null;
    const u = url.value.trim(), p = parent.value.trim(), n = name.value.trim();
    if (!u || !p || !n || /[\\/]/.test(n)) {
      err.textContent = t('fillAll');
      continue;
    }
    const dir = await api.join(p, n);
    if (!(await api.isEmptyDir(dir))) {
      err.textContent = t('folderNotEmpty');
      continue;
    }
    S.settings.cloneDir = p;
    saveSettings();
    return { url: u, dir };
  }
}

// ---------------------------------------------------------------- Neues Repository
export async function initDialog() {
  const parent = input({ value: S.settings.cloneDir || S.info.documents || S.info.home });
  const name = input({ placeholder: t('newRepoNamePh') });
  const branch = input({ value: S.settings.defaultBranch || 'main' });
  const readme = h('input', { type: 'checkbox', checked: true });
  const tpl = h('select', { class: 'input' }, h('option', { value: '', text: t('none') }), Object.keys(TEMPLATES).map((k) => h('option', { value: k, text: k })));
  const pick = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const dir = await api.pickFolder({ title: t('newRepoWhere'), defaultPath: parent.value });
    if (dir) parent.value = dir;
  } }, icon('folder', 15));
  const err = h('p', { class: 'form-error' });
  const body = h('div', { class: 'form' },
    field(t('newRepoName'), name, t('newRepoNameHint')),
    h('label', { class: 'field' }, h('span', { text: t('newRepoWhere') }), h('div', { class: 'input-row' }, parent, pick)),
    field(t('defaultBranch'), branch),
    field(t('ignoreTemplate'), tpl),
    h('label', { class: 'check' }, readme, t('addReadme')),
    err);
  for (;;) {
    const r = await dialog({ title: t('newRepoTitle'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('create'), value: 'ok', primary: true }] });
    if (r !== 'ok') return null;
    const n = name.value.trim(), p = parent.value.trim(), b = branch.value.trim() || 'main';
    if (!p || /[\\/]/.test(n)) {
      err.textContent = t('fillAll');
      continue;
    }
    const dir = n ? await api.join(p, n) : p;
    S.settings.defaultBranch = b;
    S.settings.cloneDir = p;
    saveSettings();
    return { dir, branch: b, readme: readme.checked, template: tpl.value, name: n || baseName(p) };
  }
}

/** Repository anlegen; optional mit README und .gitignore als erstem Commit */
export async function createRepo({ dir, branch, readme, template, name }) {
  const repo = await api.git('init', dir, branch);
  let files = 0;
  if (readme && !(await api.exists(await api.join(repo, 'README.md')))) {
    await api.writeText(repo, 'README.md', `# ${name}\n`);
    files++;
  }
  if (template) {
    const old = (await api.readText(repo, '.gitignore')) || '';
    await api.writeText(repo, '.gitignore', addLines(old, TEMPLATES[template], template));
    files++;
  }
  return { repo, files };
}

// ---------------------------------------------------------------- .gitignore
export async function openIgnore() {
  const text = (await api.readText(S.repo, '.gitignore')) || '';
  const area = h('textarea', { class: 'input mono ignore-text', spellcheck: 'false', rows: 14 });
  area.value = text;
  const chips = h('div', { class: 'chips' }, Object.keys(TEMPLATES).map((k) => h('button', { class: 'chip', type: 'button', text: `+ ${k}`, onclick: () => {
    area.value = addLines(area.value, TEMPLATES[k], k);
    area.scrollTop = area.scrollHeight;
  } })));
  const body = h('div', { class: 'form no-enter' }, h('p', { class: 'hint', text: t('ignoreHint') }), chips, area);
  const r = await dialog({ title: t('ignoreTitle'), body, wide: true, buttons: [{ label: t('cancel'), value: null }, { label: t('save'), value: 'ok', primary: true }] });
  if (r !== 'ok' || area.value === text) return;
  await act(() => api.writeText(S.repo, '.gitignore', area.value.endsWith('\n') || !area.value ? area.value : `${area.value}\n`));
  toast(t('ignoreSaved'));
}

export async function ignoreEntry(pattern) {
  const old = (await api.readText(S.repo, '.gitignore')) || '';
  const line = patternFor(pattern);
  await act(() => api.writeText(S.repo, '.gitignore', addLines(old, [line])));
  toast(t('ignoredAs', { p: line }));
}

// ---------------------------------------------------------------- Identität
export async function askIdentity() {
  const id = await api.git('identity', S.repo);
  const name = input({ value: id.name, placeholder: 'Erika Mustermann' });
  const email = input({ value: id.email, placeholder: 'erika@example.com', type: 'email' });
  const err = h('p', { class: 'form-error' });
  const body = h('div', { class: 'form' }, h('p', { class: 'dialog-text', text: t('identityText') }), field(t('identityName'), name), field(t('identityEmail'), email, t('identityEmailHint')), err);
  for (;;) {
    const r = await dialog({ title: t('identityTitle'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('save'), value: 'ok', primary: true }] });
    if (r !== 'ok') return false;
    if (!name.value.trim() || !/^[^\s@]+@[^\s@]+$/.test(email.value.trim())) {
      err.textContent = t('identityInvalid');
      continue;
    }
    try {
      await api.git('setConfig', null, 'user.name', name.value.trim(), { global: true });
      await api.git('setConfig', null, 'user.email', email.value.trim(), { global: true });
      return true;
    } catch (e) {
      await showError(e);
      return false;
    }
  }
}

// ---------------------------------------------------------------- Co-Autoren
export async function coAuthorDialog(list) {
  const rows = h('div', { class: 'co-rows' });
  const add = (c = { name: '', email: '' }) => {
    const n = input({ value: c.name, placeholder: t('identityName') });
    const m = input({ value: c.email, placeholder: t('identityEmail') });
    const row = h('div', { class: 'co-row' }, n, m, h('button', { class: 'icon-btn small', type: 'button', title: t('remove'), onclick: () => row.remove() }, icon('close', 14)));
    row._get = () => ({ name: n.value.trim(), email: m.value.trim() });
    rows.append(row);
  };
  (list.length ? list : [{}]).forEach(add);
  const body = h('div', { class: 'form' }, h('p', { class: 'hint', text: t('coAuthorHint') }), rows, h('button', { class: 'link-btn', type: 'button', text: t('coAuthorAdd'), onclick: () => add() }));
  const r = await dialog({ title: t('coAuthorTitle'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('ok'), value: 'ok', primary: true }] });
  if (r !== 'ok') return null;
  return [...rows.children].map((x) => x._get()).filter((c) => c.name && /@/.test(c.email));
}

// ---------------------------------------------------------------- Remote
export async function remoteDialog() {
  const list = await g('remotes');
  const cur = list.find((x) => x.name === 'origin') || list[0];
  const url = input({ value: cur ? cur.url : '', placeholder: 'https://github.com/name/projekt.git' });
  const name = input({ value: cur ? cur.name : 'origin', disabled: !!cur });
  const body = h('div', { class: 'form' },
    h('p', { class: 'dialog-text', text: cur ? t('remoteEditText') : t('remoteAddText') }),
    field(t('remoteName'), name), field(t('remoteUrl'), url, t('authNote')),
    list.length > 1 ? h('p', { class: 'hint', text: list.map((x) => `${x.name}: ${x.url}`).join('\n') }) : null);
  const r = await dialog({ title: t('remoteTitle'), body, buttons: [cur ? { label: t('remoteRemove'), value: 'remove', danger: true, left: true } : null, { label: t('cancel'), value: null }, { label: t('save'), value: 'ok', primary: true }].filter(Boolean) });
  if (r === 'remove') return act(() => g('removeRemote', cur.name));
  if (r !== 'ok' || !url.value.trim()) return null;
  return act(() => (cur ? g('setRemoteUrl', cur.name, url.value.trim()) : g('addRemote', name.value.trim() || 'origin', url.value.trim())));
}

// ---------------------------------------------------------------- Einstellungen
function select(label, value, options, onChange) {
  const sel = h('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, text: l, selected: String(v) === String(value) })));
  return h('div', { class: 'opt' }, h('label', { text: label }), sel);
}

export async function settingsDialog() {
  const st = S.settings;
  let close = null;
  const set = (key, value) => {
    st[key] = value;
    saveSettings();
    emit('theme');
  };
  const id = S.info.git && S.info.git.ok ? await api.git('identity', S.repo).catch(() => ({ name: '', email: '' })) : { name: '', email: '' };
  const idName = input({ value: id.name });
  const idMail = input({ value: id.email });
  const saveId = async () => {
    try {
      if (idName.value.trim()) await api.git('setConfig', null, 'user.name', idName.value.trim(), { global: true });
      if (idMail.value.trim()) await api.git('setConfig', null, 'user.email', idMail.value.trim(), { global: true });
    } catch (e) {
      showError(e);
    }
  };
  idName.addEventListener('change', saveId);
  idMail.addEventListener('change', saveId);
  const body = h('div', { class: 'settings' },
    select(t('setLanguage'), st.language, i18n.LANGS, (x) => {
      set('language', x);
      emit('language');
      close && close(1);
      settingsDialog();
    }),
    select(t('setMode'), st.mode, [['system', t('modeSystem')], ['light', t('modeLight')], ['dark', t('modeDark')]], (x) => set('mode', x)),
    select(t('setLook'), st.look, [['standard', t('lookStandard')], ['acryl', t('lookAcryl')]], (x) => set('look', x)),
    h('div', { class: 'opt' }, h('div', { class: 'lbl', text: t('setAccent') }), h('div', { class: 'swatches' }, ACCENTS.map((c) => h('button', { class: `swatch${c === st.accent ? ' on' : ''}`, style: { background: c }, onclick: (e) => {
      set('accent', c);
      body.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on'));
      e.currentTarget.classList.add('on');
    } })))),
    select(t('setDiff'), st.diffMode, [['split', t('viewSplit')], ['unified', t('viewUnified')]], (x) => {
      set('diffMode', x);
      emit('render');
    }),
    select(t('setPull'), st.pullMode, [['merge', t('pullMerge')], ['rebase', t('pullRebase')]], (x) => set('pullMode', x)),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.autoFetch, onchange: (e) => set('autoFetch', e.target.checked) }), t('setAutoFetch')),
    h('div', { class: 'sect-title', text: t('setIdentity') }),
    h('div', { class: 'two' }, field(t('identityName'), idName), field(t('identityEmail'), idMail)),
    h('p', { class: 'hint', text: t('setIdentityHint') }),
    h('div', { class: 'about' },
      h('div', { text: `Gitline · ${t('version', { v: S.info.version })}` }),
      h('div', { text: S.info.git && S.info.git.ok ? `Git ${S.info.git.version}` : t('gitMissingShort') }),
      h('div', { text: t('licenseNote') }),
      h('div', { text: t('noSecrets') }),
      h('a', { text: t('website'), onclick: () => api.openExternal('https://mert.win/git/') }), ' · ',
      h('a', { text: 'GitHub', onclick: () => api.openExternal('https://github.com/erqf1/gitline') })));
  await dialog({ title: t('settings'), body, buttons: [{ label: t('close'), value: 1, primary: true }], onOpen: (_c, c) => { close = c; } });
}
