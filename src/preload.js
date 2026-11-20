'use strict';

// Schmale Brücke zwischen Oberfläche und Hauptprozess (keine Node-APIs im Renderer).
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, cb) => {
  const f = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, f);
  return () => ipcRenderer.removeListener(channel, f);
};
// Fehler von git kommen als { ok:false, error } und werden hier wieder zu echten Fehlern mit Code
const unwrap = (r) => {
  if (r && r.ok) return r.value;
  const e = new Error(r && r.error ? r.error.message : 'Fehler');
  e.code = r && r.error ? r.error.code : 'GIT';
  throw e;
};

contextBridge.exposeInMainWorld('api', {
  info: () => invoke('app:info'),
  detectGit: () => invoke('app:git-detect'),
  getSettings: () => invoke('settings:get'),
  setSettings: (s) => invoke('settings:set', s),
  initialFolder: () => invoke('app:initial-folder'),
  onOpenFolder: (cb) => on('app:open-folder', cb),
  onClosing: (cb) => on('app:closing', cb),
  onFocus: (cb) => on('app:focus', cb),
  onSystemTheme: (cb) => on('app:system-theme', cb),
  closeNow: () => invoke('app:close-now'),
  updateReady: () => ipcRenderer.send('app:update-ready'),
  setTitle: (title) => invoke('app:title', title),
  setProgress: (ratio) => invoke('app:progress', ratio),

  git: (name, ...args) => invoke('git:call', name, args).then(unwrap),
  remote: (name, id, ...args) => invoke('git:remote', name, id, args).then(unwrap),
  cancel: (id) => invoke('git:cancel', id),
  onProgress: (cb) => on('git:progress', cb),
  watch: (repo) => invoke('repo:watch', repo),
  onRepoChanged: (cb) => on('repo:changed', cb),

  pickFolder: (opts) => invoke('file:pick-folder', opts),
  exists: (p) => invoke('file:exists', p),
  isEmptyDir: (p) => invoke('file:is-empty-dir', p),
  join: (...parts) => invoke('file:join', ...parts),
  image: (repo, file, rev) => invoke('file:image', repo, file, rev),
  readText: (repo, file) => invoke('file:read-text', repo, file),
  writeText: (repo, file, text) => invoke('file:write-text', repo, file, text),
  trash: (repo, files) => invoke('file:trash', repo, files),

  openExternal: (url) => invoke('shell:open-external', url),
  reveal: (p) => invoke('shell:reveal', p),
  openPath: (p) => invoke('shell:open', p),
  textlineAvailable: () => invoke('textline:available'),
  openInTextline: (file) => invoke('textline:open', file),
});
