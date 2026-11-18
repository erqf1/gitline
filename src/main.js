'use strict';

// Gitline - Hauptprozess: Fenster, Einstellungen, git aufrufen, Dateien, Updates.
// Alle Ansichten, Menüs und Dialoge leben im Renderer.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const git = require('./git');
const { t: tr } = require('./shared/i18n');

const APP_ID = 'win.mert.Gitline';
const REPO = 'erqf1/gitline';
// --selftest <ordner>: Selbsttest; --siteshots <ordner>: Bilder für die Website (beides unsichtbar)
const testArg = ['--selftest', '--siteshots'].find((a) => process.argv.includes(a));
const selfTest = testArg ? path.resolve(process.argv[process.argv.indexOf(testArg) + 1] || 'test-output') : null;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif' };

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (selfTest) {
  fs.mkdirSync(selfTest, { recursive: true });
  app.setPath('userData', path.join(selfTest, 'userdata'));
  // Selbsttest läuft unsichtbar: Fehler nur ausgeben, nie als Fehlerfenster zeigen
  process.on('uncaughtException', (e) => {
    console.log('Fehler im Selbsttest:', e && e.stack ? e.stack : e);
    app.exit(1);
  });
}

let win = null;
let settings = {};
let closingAllowed = false;
let pendingFolder = null;
let watcher = null;

const userFile = (name) => path.join(app.getPath('userData'), name);
const t = (key, vars) => tr(settings.language || 'en', key, vars);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** Ordner aus der Befehlszeile ("gitline <ordner>", Rechtsklick "Mit Gitline öffnen") */
function folderFromArgs(argv, cwd) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--selftest' || a === '--siteshots') {
      i++;
      continue;
    }
    if (!a || a.startsWith('-')) continue;
    const p = path.resolve(cwd || process.cwd(), a);
    if (p === path.resolve(app.getAppPath())) continue;
    try {
      const st = fs.statSync(p);
      return st.isDirectory() ? p : path.dirname(p);
    } catch {
      // gibt es nicht
    }
  }
  return null;
}

if (!selfTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    const dir = folderFromArgs(argv, cwd);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (dir) win.webContents.send('app:open-folder', dir);
    }
  });
}

app.on('open-file', (e, file) => {
  e.preventDefault();
  if (win && win.webContents && !win.webContents.isLoading()) win.webContents.send('app:open-folder', file);
  else pendingFolder = file;
});

function createWindow() {
  const state = settings.window || {};
  win = new BrowserWindow({
    width: state.width || 1220,
    height: state.height || 780,
    x: state.x,
    y: state.y,
    minWidth: 820,
    minHeight: 520,
    show: false,
    title: 'Gitline',
    backgroundColor: settings.mode === 'light' || (settings.mode !== 'dark' && !nativeTheme.shouldUseDarkColors) ? '#f3f4f7' : '#14161b',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      // Selbsttest: das versteckte Fenster soll trotzdem normal zeichnen
      backgroundThrottling: !selfTest,
    },
  });
  if (state.maximized && !selfTest) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!selfTest) win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || selfTest) return;
    const maximized = win.isMaximized();
    const b = maximized ? settings.window || {} : win.getBounds();
    settings.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  win.on('focus', () => win.webContents.send('app:focus'));
  // Schließen: erst fragt der Renderer nach, wenn gerade etwas mit dem Server läuft
  win.on('close', (e) => {
    if (closingAllowed || selfTest) return;
    e.preventDefault();
    win.webContents.send('app:closing');
  });
  win.on('closed', () => {
    win = null;
  });
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS braucht ein Bearbeiten-Menü, sonst gehen Kopieren/Einfügen per Cmd in Eingabefeldern nicht
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

// ---------------------------------------------------------------- IPC: Einstellungen und App
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, next) => {
  settings = { ...next, window: settings.window };
  writeJson(userFile('settings.json'), settings);
  return true;
});
ipcMain.handle('app:initial-folder', () => {
  const dir = folderFromArgs(process.argv, process.cwd()) || pendingFolder;
  pendingFolder = null;
  return dir;
});
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dark: nativeTheme.shouldUseDarkColors,
  selfTest: !!selfTest,
  siteShots: testArg === '--siteshots',
  git: git.detect(true),
  home: app.getPath('home'),
  documents: app.getPath('documents'),
  sep: path.sep,
}));
ipcMain.handle('app:git-detect', () => git.detect(true));
ipcMain.handle('app:close-now', () => {
  closingAllowed = true;
  git.cancelAll();
  if (win) win.close();
});
ipcMain.handle('app:title', (_e, title) => {
  if (win) win.setTitle(title);
});
ipcMain.handle('app:progress', (_e, ratio) => {
  if (win) win.setProgressBar(ratio == null ? -1 : ratio);
});
nativeTheme.on('updated', () => {
  if (win) win.webContents.send('app:system-theme', nativeTheme.shouldUseDarkColors);
});

// ---------------------------------------------------------------- IPC: git
// Fehler kommen als Objekt zurück, sonst verliert Electron den Fehlercode
const CALLS = new Set(['topLevel', 'init', 'status', 'operation', 'diffFile', 'untrackedDiff', 'commitDiff', 'stage', 'stageAll', 'unstage', 'unstageAll', 'applyPatch', 'discard', 'discardStagedToo',
  'commit', 'lastMessage', 'log', 'search', 'commitInfo', 'refs', 'checkRefName', 'createBranch', 'switchBranch', 'checkoutRemote', 'checkoutCommit', 'renameBranch', 'deleteBranch', 'merge',
  'abortOperation', 'continueOperation', 'resolveWith', 'markResolved', 'cherryPick', 'revert', 'resetTo', 'createTag', 'deleteTag', 'stashes', 'stashPush', 'stashApply', 'stashDrop', 'stashFiles', 'stashDiff',
  'remotes', 'addRemote', 'setRemoteUrl', 'removeRemote', 'config', 'setConfig', 'identity', 'credentialHelper', 'isIgnored']);
const REMOTE = new Set(['clone', 'fetch', 'pull', 'push', 'pushTag', 'deleteRemoteBranch']);
const wrapError = (e) => ({ ok: false, error: { message: String((e && e.message) || e), code: (e && e.code) || 'GIT' } });

ipcMain.handle('git:call', async (_e, name, args) => {
  if (!CALLS.has(name)) return wrapError(new Error(`unbekannt: ${name}`));
  try {
    return { ok: true, value: await git[name](...(args || [])) };
  } catch (e) {
    return wrapError(e);
  }
});
ipcMain.handle('git:remote', async (e, name, id, args) => {
  if (!REMOTE.has(name)) return wrapError(new Error(`unbekannt: ${name}`));
  const send = (p) => {
    if (!e.sender.isDestroyed()) e.sender.send('git:progress', { id, ...p });
  };
  const a = [...(args || [])];
  try {
    let value;
    if (name === 'clone') value = await git.clone(a[0], a[1], send, id);
    else if (name === 'fetch') value = await git.fetch(a[0], send, id);
    else if (name === 'pull') value = await git.pull(a[0], a[1] || {}, send, id);
    else if (name === 'push') value = await git.push(a[0], a[1] || {}, send, id);
    else if (name === 'pushTag') value = await git.pushTag(a[0], a[1], a[2], send, id);
    else value = await git.deleteRemoteBranch(a[0], a[1], a[2], send);
    return { ok: true, value };
  } catch (err) {
    return wrapError(err);
  }
});
ipcMain.handle('git:cancel', (_e, id) => git.cancel(id));

// Änderungen im .git-Ordner (andere Programme, Terminal) melden, damit die Ansicht aktuell bleibt
ipcMain.handle('repo:watch', async (_e, repo) => {
  if (watcher) watcher.close();
  watcher = null;
  if (!repo) return;
  try {
    const dir = await git.gitDir(repo);
    let timer = null;
    watcher = fs.watch(dir, (_ev, name) => {
      if (!name || /\.lock$/.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => win && win.webContents.send('repo:changed'), 400);
    });
    watcher.on('error', () => {});
  } catch {
    // kein Beobachten möglich, Fokus reicht auch
  }
});

// ---------------------------------------------------------------- IPC: Dateien
ipcMain.handle('file:pick-folder', async (_e, { title, defaultPath } = {}) => {
  const r = await dialog.showOpenDialog(win, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('file:exists', (_e, p) => fs.existsSync(p));
ipcMain.handle('file:is-empty-dir', (_e, p) => {
  try {
    return fs.readdirSync(p).length === 0;
  } catch {
    return !fs.existsSync(p);
  }
});
ipcMain.handle('file:join', (_e, ...parts) => path.join(...parts));
ipcMain.handle('file:basename', (_e, p) => path.basename(p));

/** Bild aus einem Stand als data-URL (für den Bilder-Vergleich) */
ipcMain.handle('file:image', async (_e, repo, file, rev) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = IMAGE_TYPES[ext];
  if (!type) return null;
  const buf = await git.fileAt(repo, file, rev);
  if (!buf || buf.length > 25 * 1024 * 1024) return null;
  return { url: `data:${type};base64,${buf.toString('base64')}`, size: buf.length };
});
ipcMain.handle('file:read-text', (_e, repo, file) => {
  try {
    const full = path.join(repo, file);
    if (fs.statSync(full).size > 4 * 1024 * 1024) return null;
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
});
ipcMain.handle('file:write-text', (_e, repo, file, text) => {
  const full = path.resolve(repo, file);
  if (!full.startsWith(path.resolve(repo))) throw new Error('außerhalb');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return true;
});
/** Unversionierte Dateien verwerfen = in den Papierkorb (lässt sich zurückholen) */
ipcMain.handle('file:trash', async (_e, repo, files) => {
  const failed = [];
  for (const f of files) {
    const full = path.resolve(repo, f);
    if (!full.startsWith(path.resolve(repo))) continue;
    try {
      if (selfTest) fs.rmSync(full, { recursive: true, force: true });
      else await shell.trashItem(full);
    } catch {
      try {
        fs.rmSync(full, { recursive: true, force: true });
      } catch {
        failed.push(f);
      }
    }
  }
  return failed;
});

ipcMain.handle('shell:open-external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));

// ---------------------------------------------------------------- Textline (falls installiert)
function textlinePath() {
  const home = app.getPath('home');
  const list = process.platform === 'win32'
    ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Textline', 'Textline.exe'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Textline', 'Textline.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Textline.app', path.join(home, 'Applications', 'Textline.app')]
      : ['/opt/Textline/textline', '/usr/bin/textline', path.join(home, '.local', 'opt', 'textline', 'textline')];
  return list.filter(Boolean).find((p) => fs.existsSync(p)) || null;
}
ipcMain.handle('textline:available', () => !!textlinePath());
ipcMain.handle('textline:open', (_e, file) => {
  const exe = textlinePath();
  if (!exe) return false;
  const child = process.platform === 'darwin'
    ? spawn('open', ['-a', exe, file], { detached: true, stdio: 'ignore' })
    : spawn(exe, [file], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  return true;
});

// ---------------------------------------------------------------- Updates (wie bei Picline, Textline und Convertline)
function isTarGz() {
  if (process.platform !== 'linux') return false;
  const exe = app.getPath('exe');
  return !exe.startsWith('/usr/') && !exe.startsWith('/opt/');
}

function setupAutoUpdate() {
  if (!app.isPackaged || selfTest) return;
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.platform === 'darwin' || isTarGz()) return setupUpdateNotice();
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  let retry = null;
  autoUpdater.on('error', () => {
    clearTimeout(retry);
    retry = setTimeout(check, 10 * 60 * 1000);
  });
  const laterFile = userFile('update.json');
  let asking = false;
  autoUpdater.on('update-downloaded', async (info) => {
    const later = readJson(laterFile, {});
    if (asking || (later.version === info.version && Date.now() < later.until)) return;
    asking = true;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: [t('restartNow'), t('later')],
      defaultId: 0,
      cancelId: 1,
      title: t('updateTitle'),
      message: t('updateReady', { version: info.version }),
      detail: t('updateDetail'),
    });
    asking = false;
    if (response === 0) {
      closingAllowed = false;
      // erst laufende Übertragungen abwarten lassen, dann installieren
      win.webContents.send('app:closing', { update: true });
      ipcMain.once('app:update-ready', () => {
        closingAllowed = true;
        autoUpdater.quitAndInstall();
      });
    } else {
      writeJson(laterFile, { version: info.version, until: Date.now() + 14 * 24 * 3600 * 1000 });
    }
  });
  setTimeout(check, 5000);
  setInterval(check, 60 * 60 * 1000);
}

function setupUpdateNotice() {
  const laterFile = userFile('update.json');
  const newer = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  let asked = false;
  const check = async () => {
    if (asked) return;
    try {
      const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Gitline' },
      });
      if (!res.ok) return;
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!version || !newer(version, app.getVersion())) return;
      const later = readJson(laterFile, {});
      if (later.version === version && Date.now() < later.until) return;
      asked = true;
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: [t('openDownloadPage'), t('later')],
        defaultId: 0,
        cancelId: 1,
        title: t('updateTitle'),
        message: t('updateAvailable', { version }),
        detail: t('updateManualDetail'),
      });
      if (response === 0) shell.openExternal(rel.html_url || `https://github.com/${REPO}/releases/latest`);
      else writeJson(laterFile, { version, until: Date.now() + 14 * 24 * 3600 * 1000 });
    } catch {
      // offline - später nochmal
    }
  };
  setTimeout(check, 8000);
  setInterval(check, 6 * 60 * 60 * 1000);
}
ipcMain.on('app:update-ready', () => {});

// ---------------------------------------------------------------- Start
app.whenReady().then(() => {
  settings = readJson(userFile('settings.json'), {});
  buildMenu();
  createWindow();
  setupAutoUpdate();
  if (selfTest) require(path.join(__dirname, '..', 'tools', testArg === '--siteshots' ? 'siteshots.js' : 'selftest.js'))(win, selfTest);
});

app.on('before-quit', () => {
  git.cancelAll();
  if (watcher) watcher.close();
  if (selfTest) return;
  try {
    writeJson(userFile('settings.json'), settings);
  } catch {
    // egal
  }
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (!win) createWindow();
});
