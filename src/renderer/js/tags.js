// Tags: anlegen (einfach oder mit Nachricht), pushen, löschen, ansehen.
import { h, confirm, dialog, toast, showMenu } from './ui.js';
import { icon } from './icons.js';
import { S, t, g, act, emit, relTime, emptyState, copyText } from './common.js';
import { commitDetails } from './history.js';
import { pushTag } from './sync.js';

let sel = null;
let filter = '';

export async function newTagDialog(target = 'HEAD') {
  const name = h('input', { class: 'input', spellcheck: 'false', placeholder: 'v1.0.0' });
  const msg = h('textarea', { class: 'input', rows: 3, spellcheck: 'false', placeholder: t('tagMsgPh') });
  const pushIt = h('input', { type: 'checkbox', checked: false, disabled: !(S.status && S.status.remotes.length) });
  const err = h('p', { class: 'form-error' });
  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', { text: t('tagName') }), name),
    h('label', { class: 'field' }, h('span', { text: t('tagMsg') }), msg),
    h('p', { class: 'hint', text: t('tagOn', { h: target.length >= 40 ? target.slice(0, 7) : target === 'HEAD' ? t('latestCommit') : target }) }),
    h('label', { class: 'check' }, pushIt, t('tagPushToo')), err);
  for (;;) {
    const r = await dialog({ title: t('newTag'), body, buttons: [{ label: t('cancel'), value: null }, { label: t('create'), value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    const n = name.value.trim();
    if (!n || /\s/.test(n) || !(await g('checkRefName', n, 'tag'))) {
      err.textContent = t('errBadName');
      continue;
    }
    if (S.refs.tags.some((x) => x.name === n)) {
      err.textContent = t('tagExists');
      continue;
    }
    const ok = await act(async () => {
      await g('createTag', n, { message: msg.value, target });
      return true;
    });
    if (ok) {
      sel = n;
      toast(t('tagCreated', { t: n }));
      if (pushIt.checked) await pushTag(n);
    }
    return;
  }
}

async function del(tag) {
  const r = await confirm(t('deleteTagTitle'), t('deleteTagMsg', { t: tag.name }), [{ label: t('cancel'), value: 'cancel' }, { label: t('delete'), value: 'ok', danger: true, primary: true }]);
  if (r !== 'ok') return;
  await act(() => g('deleteTag', tag.name));
  sel = null;
}

export function renderSide(box) {
  if (sel && !S.refs.tags.some((x) => x.name === sel)) sel = null;
  if (!sel && S.refs.tags[0]) sel = S.refs.tags[0].name;
  const search = h('input', { class: 'input search-input', placeholder: t('filterTags'), value: filter, spellcheck: 'false' });
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
  const list = h('div', { class: 'side-scroll' });
  const f = filter.trim().toLowerCase();
  for (const tag of S.refs.tags.filter((x) => !f || x.name.toLowerCase().includes(f))) {
    list.append(h('div', { class: `row tag${tag.name === sel ? ' on' : ''}`, onclick: () => { sel = tag.name; emit('render'); }, oncontextmenu: (e) => {
      e.preventDefault();
      showMenu([{ label: t('pushTag'), run: () => pushTag(tag.name) }, { label: t('copyName'), run: () => copyText(tag.name) }, '-', { label: t('delete'), run: () => del(tag) }], e.clientX, e.clientY);
    } }, h('span', { class: 'br-ico' }, icon('tag', 15)), h('div', { class: 'br-text' }, h('span', { class: 'br-name', text: tag.name }), h('small', { text: tag.subject || '' })), h('span', { class: 'muted small time', text: relTime(tag.time) })));
  }
  if (!S.refs.tags.length) list.append(h('div', { class: 'side-empty' }, icon('tag', 22), h('span', { text: t('noTags') }), h('p', { class: 'muted small', text: t('noTagsText') })));
  box.replaceChildren(h('div', { class: 'side-tools' }, h('div', { class: 'tool-row' }, h('div', { class: 'search-box' }, icon('search', 15), search),
    h('button', { class: 'btn primary', disabled: !(S.status && S.status.oid), onclick: () => newTagDialog() }, icon('plus', 15), t('new')))), list);
}

let token = 0;
export async function renderMain(box) {
  const my = ++token;
  const tag = S.refs.tags.find((x) => x.name === sel);
  if (!tag) {
    box.replaceChildren(emptyState('tag', t('noTags'), t('noTagsText')));
    return;
  }
  const actions = h('div', { class: 'main-actions' },
    h('button', { class: 'btn ghost danger', onclick: () => del(tag) }, icon('trash', 15), t('delete')),
    h('button', { class: 'btn', onclick: () => emit('new-branch', tag.hash) }, icon('branch', 15), t('branchHere')),
    h('button', { class: 'btn primary', onclick: () => pushTag(tag.name) }, icon('push', 15), t('pushTag')));
  const card = h('div', { class: 'branch-card' }, h('div', { class: 'bc-top' }, h('span', { class: 'bc-ico' }, icon('tag', 22)),
    h('div', {}, h('h2', { text: tag.name }), h('small', { class: 'muted', text: tag.annotated ? t('tagAnnotated') : t('tagLight') })), h('span', { class: 'spacer' }), actions),
    tag.annotated && tag.subject ? h('div', { class: 'bc-last', text: tag.subject }) : null);
  try {
    const details = await commitDetails(tag.hash);
    if (my !== token) return;
    box.replaceChildren(h('div', { class: 'details' }, card, details));
  } catch (e) {
    box.replaceChildren(card, emptyState('alert', t('loadFailed'), String(e.message || e)));
  }
}
