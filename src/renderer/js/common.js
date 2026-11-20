// Gemeinsamer Zustand, Texte, kleine Helfer und freundliche Fehlermeldungen.
import i18n from '../../shared/i18n.js';
import { h, dialog } from './ui.js';
import { icon } from './icons.js';

export const api = window.api;
export const S = {
  settings: {},
  info: {},
  repo: null,
  status: null,
  refs: { local: [], remote: [], tags: [] },
  stashes: [],
  remotes: [],
  tab: 'changes',
  textline: false,
  busy: 0,
};

export const t = (key, vars) => i18n.t(S.settings.language, key, vars);
/** git im aktuellen Repository aufrufen */
export const g = (name, ...args) => api.git(name, S.repo, ...args);
export const saveSettings = () => api.setSettings(S.settings);

// ---------------------------------------------------------------- Ereignisse zwischen den Ansichten
const subs = new Map();
export function on(ev, f) {
  if (!subs.has(ev)) subs.set(ev, new Set());
  subs.get(ev).add(f);
}
export function emit(ev, ...args) {
  for (const f of subs.get(ev) || []) f(...args);
}

// ---------------------------------------------------------------- Texte
export const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
export const dirName = (p) => {
  const parts = String(p || '').split('/');
  parts.pop();
  return parts.join('/');
};

export function relTime(sec) {
  if (!sec) return '';
  const lang = S.settings.language;
  const diff = sec - Date.now() / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (abs < 60) return t('justNow');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}
export function fmtDate(sec) {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleString(S.settings.language, { dateStyle: 'medium', timeStyle: 'short' });
}
export function humanSize(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toLocaleString(S.settings.language, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

/** Kleiner runder Kreis mit Anfangsbuchstaben statt Profilbild (nichts wird geladen) */
export function avatar(name, size = 28) {
  const s = String(name || '?').trim();
  let hsh = 0;
  for (const ch of s) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  const hue = [292, 220, 175, 260, 340, 200, 145, 250][hsh % 8];
  const initials = s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '?';
  return h('span', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px`, background: `hsl(${hue} 55% 46%)` }, text: initials });
}

/** Status als kleines Zeichen: geändert, neu, gelöscht, umbenannt, Konflikt */
export function statusBadge(st) {
  const map = { M: ['m', 'dot', 'stModified'], T: ['m', 'dot', 'stModified'], A: ['a', 'plus', 'stAdded'], '?': ['a', 'plus', 'stNew'], D: ['d', 'minus', 'stDeleted'], R: ['r', 'arrow', 'stRenamed'], C: ['r', 'copy', 'stCopied'], U: ['u', 'conflict', 'stConflict'] };
  const [cls, ic, key] = map[st] || map.M;
  const el = h('span', { class: `st st-${cls}`, title: t(key) }, icon(ic, 12));
  return el;
}

/** Pfad als "name" + "ordner/" daneben */
export function pathLabel(p, oldPath) {
  const name = baseName(p);
  const dir = dirName(p);
  return h('span', { class: 'path', title: oldPath ? `${oldPath} → ${p}` : p },
    h('span', { class: 'path-name', text: name }),
    dir ? h('span', { class: 'path-dir', text: dir }) : null);
}

export function copyText(text) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    // egal
  }
}

// ---------------------------------------------------------------- Fehler freundlich zeigen
const GCM = 'https://github.com/git-ecosystem/git-credential-manager/releases/latest';
export async function showError(e, title) {
  const code = (e && e.code) || 'GIT';
  const raw = String((e && e.message) || e || '').trim();
  const known = {
    AUTH: 'errAuth', NETWORK: 'errNetwork', REJECTED: 'errRejected', NO_REMOTE: 'errNoRemote', DIRTY: 'errDirty', NOT_MERGED: 'errNotMerged',
    EXISTS: 'errExists', BAD_NAME: 'errBadName', DIVERGED: 'errDiverged', NOTHING: 'errNothing', NO_GIT: 'errNoGit', CONFLICT: 'errConflict', NO_IDENTITY: 'errIdentity',
  };
  const body = h('div', {},
    h('p', { class: 'dialog-text', text: known[code] ? t(known[code]) : t('errGeneric') }),
    code === 'AUTH' ? h('p', { class: 'hint' }, t('errAuthHint'), ' ', h('a', { class: 'link', text: 'Git Credential Manager', onclick: () => api.openExternal(GCM) })) : null,
    raw ? h('details', { class: 'raw' }, h('summary', { text: t('details') }), h('pre', { class: 'error-text', text: raw })) : null);
  const buttons = [{ label: t('ok'), value: 'ok', primary: true }];
  return dialog({ title: title || t('errTitle'), body, buttons, cancelValue: 'ok' });
}

/** Etwas mit git machen; Fehler werden gezeigt, die Ansicht danach neu geladen */
export async function act(fn, { title, refresh = true } = {}) {
  S.busy++;
  emit('busy');
  try {
    return await fn();
  } catch (e) {
    await showError(e, title);
    return undefined;
  } finally {
    S.busy--;
    emit('busy');
    if (refresh) emit('refresh');
  }
}

export function emptyState(ic, title, text, ...extra) {
  return h('div', { class: 'empty-state' }, icon(ic, 34), h('b', { text: title }), text ? h('p', { text }) : null, ...extra);
}
