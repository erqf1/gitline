'use strict';

// Gitline - alles, was mit dem installierten git spricht. Läuft im Hauptprozess.
// Gitline speichert keine Passwörter oder Tokens: Anmeldungen übernimmt der Credential Manager des Systems,
// den git selbst aufruft. Eine Eingabe im Terminal ist abgeschaltet, damit nichts unsichtbar hängen bleibt.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseStatus } = require('./shared/status');
const { parseLog, LOG_FORMAT } = require('./shared/log');
const { parseProgress } = require('./shared/progress');

let gitPath = null;
let gitVersion = null;
const running = new Map();
let nextId = 1;

// Wo git bei Programmen ohne Terminal-PATH oft liegt (macOS-Dock, Windows-Startmenü)
function candidates() {
  if (process.platform === 'win32') {
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    return ['git', ...pf.map((p) => path.join(p, 'Git', 'cmd', 'git.exe'))];
  }
  return ['git', '/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'];
}

function extraPath() {
  if (process.platform === 'win32') return process.env.PATH || '';
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const have = (process.env.PATH || '').split(':');
  return [...have, ...dirs.filter((d) => !have.includes(d))].join(':');
}

function baseEnv(extra = {}) {
  return {
    ...process.env,
    PATH: extraPath(),
    // Englische Meldungen, damit Fortschritt und Fehler sicher erkannt werden
    LC_ALL: 'C',
    LANGUAGE: 'C',
    GIT_TERMINAL_PROMPT: '0',
    // Kein Editor und kein Pager darf sich öffnen
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_PAGER: 'cat',
    GIT_MERGE_AUTOEDIT: 'no',
    // status soll den Index nicht nebenbei neu schreiben (sonst meldet der Ordner-Beobachter ständig Änderungen)
    GIT_OPTIONAL_LOCKS: '0',
    ...extra,
  };
}

/** Sucht git; liefert { ok, version, path } */
function detect(force = false) {
  if (gitPath && !force) return { ok: true, version: gitVersion, path: gitPath };
  for (const c of candidates()) {
    try {
      const out = execFileSync(c, ['--version'], { env: baseEnv(), encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /git version (\S+)/.exec(out);
      if (m) {
        gitPath = c;
        gitVersion = m[1];
        return { ok: true, version: gitVersion, path: gitPath };
      }
    } catch {
      // nächster Kandidat
    }
  }
  gitPath = null;
  return { ok: false };
}

const COMMON = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'i18n.logOutputEncoding=UTF-8', '-c', 'core.pager=cat', '-c', 'advice.detachedHead=false'];

/**
 * Startet git. opts: { cwd, input, onProgress, okCodes, env, id }
 * Liefert Promise { code, out, err } (out als String, oder Buffer bei binary).
 */
function run(args, opts = {}) {
  if (!gitPath && !detect().ok) return Promise.reject(Object.assign(new Error('Git wurde nicht gefunden.'), { code: 'NO_GIT' }));
  return new Promise((resolve, reject) => {
    const id = opts.id || `g${nextId++}`;
    const child = spawn(gitPath, [...COMMON, ...args], { cwd: opts.cwd, env: baseEnv(opts.env), windowsHide: true });
    running.set(id, child);
    const out = [];
    let err = '';
    let errLine = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      err += s;
      if (err.length > 200000) err = err.slice(-100000);
      if (opts.onProgress) {
        errLine += s;
        const parts = errLine.split(/[\r\n]/);
        errLine = parts.pop();
        for (const p of parts) {
          const pr = parseProgress(p);
          if (pr) opts.onProgress(pr);
        }
        const pr = parseProgress(errLine);
        if (pr) opts.onProgress(pr);
      }
    });
    child.on('error', (e) => {
      running.delete(id);
      reject(e);
    });
    child.on('close', (code, signal) => {
      running.delete(id);
      const buf = Buffer.concat(out);
      const res = { code, signal, out: opts.binary ? buf : buf.toString('utf8'), err };
      const ok = opts.okCodes || [0];
      if (ok.includes(code)) resolve(res);
      else reject(gitError(args, res));
    });
    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

function cancel(id) {
  const c = running.get(id);
  if (c) c.kill();
}
function cancelAll() {
  for (const c of running.values()) c.kill();
}

/** Fehlermeldung von git in eine Art übersetzen, die die Oberfläche freundlich zeigen kann */
function classify(text) {
  const s = String(text || '');
  if (/terminal prompts disabled|could not read (Username|Password)|Authentication failed|HTTP Basic: Access denied|invalid username or password|403|Permission denied \(publickey/i.test(s)) return 'AUTH';
  if (/Could not resolve host|unable to access|Connection timed out|Network is unreachable|Failed to connect/i.test(s)) return 'NETWORK';
  if (/\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i.test(s)) return 'REJECTED';
  if (/no upstream branch|has no upstream|There is no tracking information/i.test(s)) return 'NO_UPSTREAM';
  if (/does not appear to be a git repository|No configured push destination|No remote repository specified/i.test(s)) return 'NO_REMOTE';
  if (/Please tell me who you are|Author identity unknown|empty ident name/i.test(s)) return 'NO_IDENTITY';
  if (/would be overwritten by (checkout|merge)|Please commit your changes or stash them/i.test(s)) return 'DIRTY';
  if (/CONFLICT|Automatic merge failed|fix conflicts/i.test(s)) return 'CONFLICT';
  if (/not fully merged/i.test(s)) return 'NOT_MERGED';
  if (/already exists/i.test(s)) return 'EXISTS';
  if (/divergent branches|Need to specify how to reconcile/i.test(s)) return 'DIVERGED';
  if (/nothing to commit|no changes added to commit/i.test(s)) return 'NOTHING';
  if (/not a valid (branch|ref) name|is not a valid branch name/i.test(s)) return 'BAD_NAME';
  return 'GIT';
}

function gitError(args, res) {
  const text = (res.err || res.out || '').toString().trim();
  const e = new Error(text || `git ${args[0]} ist fehlgeschlagen (${res.code})`);
  e.code = classify(`${text}\n${typeof res.out === 'string' ? res.out : ''}`);
  e.exitCode = res.code;
  e.stdout = typeof res.out === 'string' ? res.out : '';
  return e;
}

const lines = (s) => s.split('\n').filter(Boolean);
const tmpFile = (content) => {
  const f = path.join(os.tmpdir(), `gitline-${process.pid}-${nextId++}.txt`);
  fs.writeFileSync(f, content);
  return f;
};

// ---------------------------------------------------------------- Repository
async function topLevel(dir) {
  try {
    const r = await run(['rev-parse', '--show-toplevel'], { cwd: dir });
    return path.resolve(r.out.trim());
  } catch {
    return null;
  }
}

async function init(dir, branch = 'main') {
  fs.mkdirSync(dir, { recursive: true });
  try {
    await run(['init', '-b', branch], { cwd: dir });
  } catch {
    await run(['init'], { cwd: dir });
    await run(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: dir });
  }
  return path.resolve(dir);
}

async function clone(url, dir, onProgress, id) {
  await run(['clone', '--progress', '--', url, dir], { onProgress, id, cwd: path.dirname(dir) });
  return path.resolve(dir);
}

async function gitDir(repo) {
  const r = await run(['rev-parse', '--absolute-git-dir'], { cwd: repo });
  return r.out.trim();
}

/** Läuft gerade ein Merge, Rebase, Cherry-Pick oder Revert? */
async function operation(repo) {
  const g = await gitDir(repo);
  const has = (p) => fs.existsSync(path.join(g, p));
  if (has('rebase-merge') || has('rebase-apply')) {
    let onto = '';
    try {
      onto = fs.readFileSync(path.join(g, has('rebase-merge') ? 'rebase-merge' : 'rebase-apply', 'head-name'), 'utf8').trim().replace(/^refs\/heads\//, '');
    } catch {
      // egal
    }
    return { kind: 'rebase', name: onto };
  }
  if (has('MERGE_HEAD')) {
    let name = '';
    try {
      const msg = fs.readFileSync(path.join(g, 'MERGE_MSG'), 'utf8');
      const m = /Merge (?:remote-tracking )?branch '([^']+)'/.exec(msg);
      name = m ? m[1] : '';
    } catch {
      // egal
    }
    return { kind: 'merge', name };
  }
  if (has('CHERRY_PICK_HEAD')) return { kind: 'cherry-pick', name: '' };
  if (has('REVERT_HEAD')) return { kind: 'revert', name: '' };
  return null;
}

async function status(repo) {
  const r = await run(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--ignore-submodules=dirty'], { cwd: repo });
  const st = parseStatus(r.out);
  st.operation = await operation(repo);
  try {
    const rr = await run(['remote'], { cwd: repo });
    st.remotes = lines(rr.out);
  } catch {
    st.remotes = [];
  }
  return st;
}

// ---------------------------------------------------------------- Diffs
const DIFF = ['--no-color', '--no-ext-diff', '-M'];

async function diffFile(repo, file, { staged = false, context = 3, oldFile } = {}) {
  const args = ['diff', ...DIFF, `-U${context}`];
  if (staged) args.push('--cached');
  args.push('--', file);
  if (oldFile && staged) args.push(oldFile);
  const r = await run(args, { cwd: repo });
  return r.out;
}

/** Neue (unversionierte) Datei als Diff, ohne sie anzufassen */
function untrackedDiff(repo, file) {
  const full = path.join(repo, file);
  let buf;
  try {
    const st = fs.statSync(full);
    if (st.isDirectory()) return { text: '', binary: false, size: 0 };
    if (st.size > 8 * 1024 * 1024) return { text: '', binary: true, size: st.size, tooBig: true };
    buf = fs.readFileSync(full);
  } catch {
    return { text: '', binary: false, size: 0 };
  }
  if (buf.subarray(0, 8000).includes(0)) return { text: `diff --git a/${file} b/${file}\nnew file mode 100644\nBinary files /dev/null and b/${file} differ\n`, binary: true, size: buf.length };
  const text = buf.toString('utf8');
  if (!text.length) return { text: `diff --git a/${file} b/${file}\nnew file mode 100644\n`, binary: false, size: 0 };
  const ls = text.split('\n');
  const noEol = !text.endsWith('\n');
  if (!noEol) ls.pop();
  let out = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1${ls.length === 1 ? '' : `,${ls.length}`} @@\n`;
  out += ls.map((l) => `+${l}`).join('\n');
  out += '\n';
  if (noEol) out += '\\ No newline at end of file\n';
  return { text: out, binary: false, size: buf.length };
}

/** Inhalt einer Datei in einem Stand: rev = 'WORK' (Arbeitsordner), ':' (Index), sonst Commit */
async function fileAt(repo, file, rev) {
  if (rev === 'WORK') {
    try {
      return fs.readFileSync(path.join(repo, file));
    } catch {
      return null;
    }
  }
  try {
    const r = await run(['show', `${rev === ':' ? '' : rev}:${file}`], { cwd: repo, binary: true });
    return r.out;
  } catch {
    return null;
  }
}

async function commitDiff(repo, hash, file, parent) {
  if (parent) {
    const r = await run(['diff', ...DIFF, parent, hash, '--', file], { cwd: repo });
    return r.out;
  }
  const r = await run(['diff-tree', '-p', '--root', ...DIFF, hash, '--', file], { cwd: repo });
  return r.out.replace(/^[0-9a-f]{40}\n/, '');
}

// ---------------------------------------------------------------- Vormerken (Index)
async function stage(repo, files) {
  if (!files.length) return;
  await run(['add', '-A', '--', ...files], { cwd: repo });
}
async function stageAll(repo) {
  await run(['add', '-A'], { cwd: repo });
}
async function unstage(repo, files) {
  if (!files.length) return;
  try {
    await run(['restore', '--staged', '--', ...files], { cwd: repo });
  } catch (e) {
    // Noch kein Commit: restore --staged geht nicht, rm --cached schon
    await run(['rm', '--cached', '-r', '-q', '--', ...files], { cwd: repo });
  }
}
async function unstageAll(repo) {
  try {
    await run(['reset', '-q'], { cwd: repo });
  } catch {
    await run(['rm', '--cached', '-r', '-q', '.'], { cwd: repo });
  }
}

/** Patch auf Index oder Arbeitsordner anwenden (für einzelne Abschnitte) */
async function applyPatch(repo, patch, { cached = true, reverse = false } = {}) {
  const args = ['apply', '--whitespace=nowarn'];
  if (cached) args.push('--cached');
  if (reverse) args.push('--reverse');
  args.push('-');
  await run(args, { cwd: repo, input: patch });
}

/** Änderungen verwerfen. tracked: zurück auf den Index; untracked: löschen (in den Papierkorb macht main.js) */
async function discard(repo, files) {
  if (!files.length) return;
  await run(['checkout', '--', ...files], { cwd: repo });
}
async function discardStagedToo(repo, files) {
  // Vorgemerkt UND im Arbeitsordner auf HEAD zurück
  await run(['checkout', 'HEAD', '--', ...files], { cwd: repo });
}

// ---------------------------------------------------------------- Commit
function buildMessage(summary, body, coAuthors = []) {
  let msg = String(summary || '').trim();
  const b = String(body || '').replace(/\s+$/, '');
  if (b) msg += `\n\n${b}`;
  const co = (coAuthors || []).filter((c) => c && c.name && c.email);
  if (co.length) msg += `\n\n${co.map((c) => `Co-authored-by: ${c.name.trim()} <${c.email.trim()}>`).join('\n')}`;
  return `${msg}\n`;
}

async function commit(repo, { summary, body, coAuthors, amend = false, allowEmpty = false }) {
  const f = tmpFile(buildMessage(summary, body, coAuthors));
  try {
    const args = ['commit', '-F', f, '--cleanup=strip'];
    if (amend) args.push('--amend');
    if (allowEmpty) args.push('--allow-empty');
    await run(args, { cwd: repo });
  } finally {
    fs.rmSync(f, { force: true });
  }
  const r = await run(['rev-parse', 'HEAD'], { cwd: repo });
  return r.out.trim();
}

async function lastMessage(repo) {
  try {
    const r = await run(['log', '-1', '--format=%B'], { cwd: repo });
    return r.out;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- Verlauf
async function log(repo, { all = false, ref = null, skip = 0, max = 300, file = null, grep = null, author = null } = {}) {
  const args = ['log', '--decorate=full', `--format=${LOG_FORMAT}`, '-z', `--max-count=${max}`, `--skip=${skip}`];
  if (file) args.push('--follow');
  else args.push('--topo-order');
  if (grep) args.push('-i', '-F', `--grep=${grep}`);
  if (author) args.push('-i', '-F', `--author=${author}`);
  if (all) args.push('--branches', '--remotes', '--tags', 'HEAD');
  else if (ref) args.push(ref);
  if (file) args.push('--', file);
  try {
    const r = await run(args, { cwd: repo });
    return parseLog(r.out);
  } catch (e) {
    // Leeres Repository ohne Commit
    if (/does not have any commits|unknown revision|bad default revision|ambiguous argument 'HEAD'/i.test(e.message)) return [];
    throw e;
  }
}

/** Suche in Nachricht, Autor und Hash */
async function search(repo, q, { all = true, max = 300 } = {}) {
  const text = String(q || '').trim();
  if (!text) return [];
  const [byMsg, byAuthor] = await Promise.all([log(repo, { all, grep: text, max }), log(repo, { all, author: text, max })]);
  const seen = new Map();
  for (const c of [...byMsg, ...byAuthor]) seen.set(c.hash, c);
  if (/^[0-9a-f]{4,40}$/i.test(text)) {
    try {
      const r = await run(['log', '-1', '--decorate=full', `--format=${LOG_FORMAT}`, '-z', text], { cwd: repo });
      for (const c of parseLog(r.out)) seen.set(c.hash, c);
    } catch {
      // kein Hash
    }
  }
  return [...seen.values()].sort((a, b) => b.time - a.time).slice(0, max);
}

async function commitInfo(repo, hash) {
  const r = await run(['show', '-s', '--decorate=full', `--format=${LOG_FORMAT}%x1f%B`, '-z', hash], { cwd: repo });
  const [c] = parseLog(r.out, true);
  const parent = c.parents[0] || null;
  const args = parent ? ['diff', '--name-status', '-z', '-M', parent, hash] : ['diff-tree', '--root', '-r', '--name-status', '-z', '-M', '--no-commit-id', hash];
  const fr = await run(args, { cwd: repo });
  c.files = parseNameStatus(fr.out);
  const nr = await run(parent ? ['diff', '--numstat', '-z', '-M', parent, hash] : ['diff-tree', '--root', '-r', '--numstat', '-z', '-M', '--no-commit-id', hash], { cwd: repo });
  const stats = parseNumstat(nr.out);
  for (const f of c.files) Object.assign(f, stats.get(f.path) || {});
  return c;
}

function parseNameStatus(out) {
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    const code = s[0];
    if (code === 'R' || code === 'C') {
      files.push({ status: code, oldPath: parts[i + 1], path: parts[i + 2] });
      i += 2;
    } else {
      files.push({ status: code, path: parts[i + 1] });
      i += 1;
    }
  }
  return files;
}

function parseNumstat(out) {
  const parts = out.split('\0');
  const map = new Map();
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(s);
    if (!m) continue;
    let file = m[3];
    if (!file) {
      // Umbenennung: alter und neuer Name folgen
      file = parts[i + 2];
      i += 2;
    }
    map.set(file, { added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]), binary: m[1] === '-' });
  }
  return map;
}

// ---------------------------------------------------------------- Branches und Tags
async function refs(repo) {
  const fmt = ['%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track)', '%(HEAD)', '%(committerdate:unix)', '%(subject)', '%(*objectname)', '%(taggerdate:unix)', '%(contents:subject)', '%(objecttype)'].join('%1f');
  const r = await run(['for-each-ref', `--format=${fmt}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes', 'refs/tags'], { cwd: repo });
  const out = { local: [], remote: [], tags: [] };
  for (const line of lines(r.out)) {
    const [ref, hash, upstream, track, head, time, subject, peeled, tagTime, tagSubject, type] = line.split('\x1f');
    if (ref.startsWith('refs/heads/')) {
      const ahead = /ahead (\d+)/.exec(track), behind = /behind (\d+)/.exec(track);
      out.local.push({ name: ref.slice(11), hash, upstream, gone: /gone/.test(track), ahead: ahead ? +ahead[1] : 0, behind: behind ? +behind[1] : 0, current: head === '*', time: +time || 0, subject });
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice(13);
      if (name.endsWith('/HEAD')) continue;
      out.remote.push({ name, remote: name.split('/')[0], branch: name.split('/').slice(1).join('/'), hash, time: +time || 0, subject });
    } else {
      out.tags.push({ name: ref.slice(10), hash: peeled || hash, annotated: type === 'tag', time: +tagTime || +time || 0, subject: type === 'tag' ? tagSubject : subject });
    }
  }
  out.tags.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name, undefined, { numeric: true }));
  return out;
}

async function checkRefName(repo, name, kind = 'branch') {
  try {
    await run(['check-ref-format', kind === 'branch' ? '--branch' : '--normalize', kind === 'branch' ? name : `refs/tags/${name}`], { cwd: repo });
    return true;
  } catch {
    return false;
  }
}

async function createBranch(repo, name, { from = null, checkout = true } = {}) {
  if (checkout) await run(['switch', '-c', name, ...(from ? [from] : [])], { cwd: repo });
  else await run(['branch', name, ...(from ? [from] : [])], { cwd: repo });
}
async function switchBranch(repo, name) {
  await run(['switch', name], { cwd: repo });
}
async function checkoutRemote(repo, remoteName) {
  // origin/feature -> lokaler Branch feature, der origin/feature folgt
  const local = remoteName.split('/').slice(1).join('/');
  try {
    await run(['switch', '-c', local, '--track', remoteName], { cwd: repo });
  } catch (e) {
    if (e.code === 'EXISTS') await run(['switch', local], { cwd: repo });
    else throw e;
  }
  return local;
}
async function checkoutCommit(repo, hash) {
  await run(['switch', '--detach', hash], { cwd: repo });
}
async function renameBranch(repo, oldName, newName) {
  await run(['branch', '-m', oldName, newName], { cwd: repo });
}
async function deleteBranch(repo, name, force = false) {
  await run(['branch', force ? '-D' : '-d', name], { cwd: repo });
}
async function deleteRemoteBranch(repo, remote, branch, onProgress) {
  await run(['push', '--progress', remote, '--delete', branch], { cwd: repo, onProgress });
}
async function merge(repo, name, { noFf = false } = {}) {
  const args = ['merge', '--no-edit'];
  if (noFf) args.push('--no-ff');
  args.push(name);
  try {
    const r = await run(args, { cwd: repo });
    return { ok: true, upToDate: /Already up to date/i.test(r.out), fastForward: /Fast-forward/i.test(r.out) };
  } catch (e) {
    if (e.code === 'CONFLICT') return { ok: false, conflict: true, message: e.stdout || e.message };
    throw e;
  }
}
async function abortOperation(repo, kind) {
  if (kind === 'rebase') await run(['rebase', '--abort'], { cwd: repo });
  else if (kind === 'cherry-pick') await run(['cherry-pick', '--abort'], { cwd: repo });
  else if (kind === 'revert') await run(['revert', '--abort'], { cwd: repo });
  else await run(['merge', '--abort'], { cwd: repo });
}
async function continueOperation(repo, kind) {
  if (kind === 'rebase') await run(['rebase', '--continue'], { cwd: repo });
  else if (kind === 'cherry-pick') await run(['cherry-pick', '--continue'], { cwd: repo });
  else if (kind === 'revert') await run(['revert', '--continue'], { cwd: repo });
  else await run(['commit', '--no-edit'], { cwd: repo });
}

/** Konflikt lösen: 'ours' (meine) oder 'theirs' (deren) */
async function resolveWith(repo, file, side) {
  try {
    await run(['checkout', `--${side}`, '--', file], { cwd: repo });
    await run(['add', '--', file], { cwd: repo });
  } catch (e) {
    // Auf einer Seite gelöscht: dann eben löschen
    if (/does not have (our|their) version/i.test(e.message)) await run(['rm', '-q', '--', file], { cwd: repo });
    else throw e;
  }
}
async function markResolved(repo, file) {
  if (fs.existsSync(path.join(repo, file))) await run(['add', '--', file], { cwd: repo });
  else await run(['rm', '-q', '--cached', '--', file], { cwd: repo });
}

async function cherryPick(repo, hash) {
  try {
    await run(['cherry-pick', hash], { cwd: repo });
    return { ok: true };
  } catch (e) {
    if (e.code === 'CONFLICT' || /after resolving the conflicts/i.test(e.message)) return { ok: false, conflict: true };
    throw e;
  }
}
async function revert(repo, hash) {
  try {
    await run(['revert', '--no-edit', hash], { cwd: repo });
    return { ok: true };
  } catch (e) {
    if (e.code === 'CONFLICT' || /after resolving the conflicts/i.test(e.message)) return { ok: false, conflict: true };
    throw e;
  }
}
async function resetTo(repo, hash, mode = 'mixed') {
  await run(['reset', `--${mode}`, hash], { cwd: repo });
}

async function createTag(repo, name, { message = '', target = 'HEAD' } = {}) {
  if (message.trim()) {
    const f = tmpFile(`${message.trim()}\n`);
    try {
      await run(['tag', '-a', name, '-F', f, target], { cwd: repo });
    } finally {
      fs.rmSync(f, { force: true });
    }
  } else await run(['tag', name, target], { cwd: repo });
}
async function deleteTag(repo, name) {
  await run(['tag', '-d', name], { cwd: repo });
}
async function pushTag(repo, remote, name, onProgress, id) {
  await run(['push', '--progress', remote, `refs/tags/${name}`], { cwd: repo, onProgress, id });
}

// ---------------------------------------------------------------- Stash
async function stashes(repo) {
  try {
    const r = await run(['stash', 'list', '--format=%gd%x1f%H%x1f%ct%x1f%gs'], { cwd: repo });
    return lines(r.out).map((l) => {
      const [ref, hash, time, subject] = l.split('\x1f');
      const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject || '');
      return { ref, hash, time: +time, branch: m ? m[1] : '', message: m ? m[2] : subject };
    });
  } catch {
    return [];
  }
}
async function stashPush(repo, { message = '', untracked = true, staged = false } = {}) {
  const args = ['stash', 'push'];
  if (untracked) args.push('--include-untracked');
  if (staged) args.push('--staged');
  if (message.trim()) args.push('-m', message.trim());
  const r = await run(args, { cwd: repo });
  return !/No local changes to save/i.test(r.out + r.err);
}
async function stashApply(repo, ref, pop = false) {
  try {
    await run(['stash', pop ? 'pop' : 'apply', '--index', ref], { cwd: repo });
    return { ok: true };
  } catch (e) {
    if (/conflict/i.test(e.message)) return { ok: false, conflict: true };
    // --index klappt nicht immer (z. B. wenn der Index sich verändert hat): ohne nochmal
    if (/--index|Conflicts in index|could not restore/i.test(e.message)) {
      await run(['stash', pop ? 'pop' : 'apply', ref], { cwd: repo });
      return { ok: true };
    }
    throw e;
  }
}
async function stashDrop(repo, ref) {
  await run(['stash', 'drop', ref], { cwd: repo });
}
async function stashFiles(repo, ref) {
  const r = await run(['stash', 'show', '--name-status', '-z', '-M', ref], { cwd: repo });
  const files = parseNameStatus(r.out);
  // Unversionierte Dateien liegen im dritten Eltern-Commit
  try {
    const u = await run(['ls-tree', '-r', '--name-only', '-z', `${ref}^3`], { cwd: repo });
    for (const f of u.out.split('\0').filter(Boolean)) if (!files.some((x) => x.path === f)) files.push({ status: 'A', path: f, untracked: true });
  } catch {
    // keine unversionierten Dateien im Stash
  }
  return files;
}
async function stashDiff(repo, ref, file, untracked) {
  if (untracked) {
    const r = await run(['diff-tree', '-p', '--root', ...DIFF, `${ref}^3`, '--', file], { cwd: repo });
    return r.out.replace(/^[0-9a-f]{40}\n/, '');
  }
  const r = await run(['diff', ...DIFF, `${ref}^1`, ref, '--', file], { cwd: repo });
  return r.out;
}

// ---------------------------------------------------------------- Remotes
async function remotes(repo) {
  const r = await run(['remote', '-v'], { cwd: repo });
  const map = new Map();
  for (const l of lines(r.out)) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(l);
    if (m && !map.has(m[1])) map.set(m[1], { name: m[1], url: m[2] });
  }
  return [...map.values()];
}
async function addRemote(repo, name, url) {
  await run(['remote', 'add', name, url], { cwd: repo });
}
async function setRemoteUrl(repo, name, url) {
  await run(['remote', 'set-url', name, url], { cwd: repo });
}
async function removeRemote(repo, name) {
  await run(['remote', 'remove', name], { cwd: repo });
}

async function fetch(repo, onProgress, id) {
  await run(['fetch', '--all', '--prune', '--tags', '--progress'], { cwd: repo, onProgress, id });
}
async function pull(repo, { rebase = false } = {}, onProgress, id) {
  try {
    await run(['pull', '--progress', rebase ? '--rebase' : '--no-rebase'], { cwd: repo, onProgress, id });
    return { ok: true };
  } catch (e) {
    if (e.code === 'CONFLICT' || /could not apply|Resolve all conflicts/i.test(e.message)) return { ok: false, conflict: true };
    throw e;
  }
}
async function push(repo, { branch, remote = null, setUpstream = false, force = false, tags = false, ref = null } = {}, onProgress, id) {
  const args = ['push', '--progress'];
  if (force) args.push('--force-with-lease');
  // ref: ein anderer lokaler Branch als der ausgecheckte
  const src = ref ? `refs/heads/${ref}` : 'HEAD';
  if (setUpstream) args.push('-u', remote || 'origin', `${src}:refs/heads/${branch}`);
  else if (ref) args.push(remote || 'origin', `${src}:refs/heads/${branch}`);
  else if (remote) args.push(remote);
  await run(args, { cwd: repo, onProgress, id });
  if (tags) await run(['push', '--progress', '--tags', remote || 'origin'], { cwd: repo, onProgress, id });
}

// ---------------------------------------------------------------- Einstellungen von git
async function config(repo, key, { global = false } = {}) {
  try {
    const r = await run(['config', ...(global ? ['--global'] : []), '--get', key], { cwd: repo || os.homedir() });
    return r.out.trim();
  } catch {
    return '';
  }
}
async function setConfig(repo, key, value, { global = false } = {}) {
  await run(['config', ...(global ? ['--global'] : []), key, value], { cwd: repo || os.homedir() });
}
async function identity(repo) {
  return { name: await config(repo, 'user.name'), email: await config(repo, 'user.email') };
}

/** Gibt es einen Credential Manager? (nur Hinweis, Gitline speichert selbst nichts) */
async function credentialHelper(repo) {
  return config(repo, 'credential.helper');
}

async function isIgnored(repo, file) {
  try {
    await run(['check-ignore', '-q', '--', file], { cwd: repo });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  detect, run, cancel, cancelAll, classify, topLevel, init, clone, gitDir, operation, status,
  diffFile, untrackedDiff, fileAt, commitDiff, stage, stageAll, unstage, unstageAll, applyPatch, discard, discardStagedToo,
  buildMessage, commit, lastMessage, log, search, commitInfo, parseNameStatus, parseNumstat,
  refs, checkRefName, createBranch, switchBranch, checkoutRemote, checkoutCommit, renameBranch, deleteBranch, deleteRemoteBranch, merge,
  abortOperation, continueOperation, resolveWith, markResolved, cherryPick, revert, resetTo,
  createTag, deleteTag, pushTag, stashes, stashPush, stashApply, stashDrop, stashFiles, stashDiff,
  remotes, addRemote, setRemoteUrl, removeRemote, fetch, pull, push, config, setConfig, identity, credentialHelper, isIgnored,
};
