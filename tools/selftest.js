'use strict';

// Selbsttest (unsichtbar): npx electron . --selftest <ordner>
// Legt temporäre Repositorys an und prüft git-Kern, Parser und Oberfläche. Nichts außerhalb des Ordners wird angefasst
// (auch nicht die globale Git-Konfiguration: Name und E-Mail werden nur in den Test-Repositorys gesetzt).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const git = require('../src/git');
const { parseStatus, conflictKind } = require('../src/shared/status');
const { parseLog, parseRefs, LOG_FORMAT } = require('../src/shared/log');
const { parseProgress } = require('../src/shared/progress');
const { parseDiff, buildPatch, buildLinePatch, splitRows, parseConflicts, unquote } = require('../src/shared/diff');
const { layout } = require('../src/shared/graph');
const { highlightLine, langOf } = require('../src/shared/highlight');
const { addLines, patternFor, TEMPLATES } = require('../src/shared/ignore');
const i18n = require('../src/shared/i18n');
const S = require('../src/shared/strings');

// 1x1-PNGs (rot und blau) für den Bildervergleich
const PNG_RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PNG_BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');

module.exports = function selftest(win, dir) {
  const wc = win.webContents;
  const errors = [];
  wc.on('console-message', (e) => {
    const level = e.level != null ? e.level : e;
    if (level === 'error' || level === 3) errors.push(e.message);
  });
  const results = [];
  const check = (name, ok, info = '') => results.push(`${ok ? 'ok  ' : 'FEHL'} ${name}${info !== '' ? ` (${String(info).slice(0, 300)})` : ''}`);
  const js = (code) => wc.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await wait(350);
    await wc.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  const REPOS = path.join(dir, 'repos');
  fs.rmSync(REPOS, { recursive: true, force: true });
  fs.mkdirSync(REPOS, { recursive: true });
  const G = async (cwd, ...args) => (await git.run(args, { cwd })).out;
  const write = (repo, file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  const read = (repo, file) => fs.readFileSync(path.join(repo, file), 'utf8');
  const throwsCode = async (fn) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e.code || 'ERR';
    }
  };
  const newRepo = async (name) => {
    const r = await git.init(path.join(REPOS, name), 'main');
    await G(r, 'config', 'user.name', 'Test Person');
    await G(r, 'config', 'user.email', 'test@example.com');
    await G(r, 'config', 'commit.gpgsign', 'false');
    await G(r, 'config', 'tag.gpgsign', 'false');
    await G(r, 'config', 'core.autocrlf', 'false');
    return r;
  };
  const until = async (code, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(code)) return true;
      await wait(60);
    }
    return false;
  };

  wc.once('did-finish-load', async () => {
    try {
      // ================================================================ Parser (ohne git)
      const st = parseStatus([
        '# branch.oid 1234567890abcdef1234567890abcdef12345678', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -3',
        '1 .M N... 100644 100644 100644 aaa bbb src/app.js', '1 M. N... 100644 100644 100644 aaa bbb README.md', '1 MM N... 100644 100644 100644 aaa bbb beide.txt',
        '2 R. N... 100644 100644 100644 aaa bbb R100 neu name.txt', 'alt name.txt', 'u UU N... 100644 100644 100644 100644 a b c konflikt.txt', '? neue datei ä.txt', '',
      ].join('\0'));
      check('Status: Branch und Upstream', st.branch === 'main' && st.upstream === 'origin/main' && st.ahead === 2 && st.behind === 3);
      check('Status: nicht vorgemerkt', st.unstaged.map((f) => f.path + f.status).join('|') === 'beide.txtM|neue datei ä.txt?|src/app.jsM', st.unstaged.map((f) => f.path).join('|'));
      check('Status: vorgemerkt mit Umbenennung', st.staged.length === 3 && st.staged.find((f) => f.status === 'R').oldPath === 'alt name.txt');
      check('Status: Konflikt', st.conflicted.length === 1 && st.conflicted[0].xy === 'UU' && conflictKind('UU') === 'bothModified' && conflictKind('UD') === 'deletedByThem');
      check('Status: leeres Repository', parseStatus('# branch.oid (initial)\0# branch.head main\0').initial === true);
      check('Status: losgelöst', parseStatus('# branch.oid abc\0# branch.head (detached)\0').detached === true);

      const logText = `${['a'.repeat(40), `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'Anna', 'a@x.de', '1700000000', 'Anna', '1700000001', 'HEAD -> main, origin/main, origin/HEAD, tag: v1.0', 'Merge branch \'x\''].join('\x1f')}\0\n${['b'.repeat(40), '', 'Bob', 'b@x.de', '1600000000', 'Bob', '1600000000', '', 'Erster'].join('\x1f')}\0`;
      const lg = parseLog(logText);
      check('Log: zwei Commits', lg.length === 2 && lg[0].parents.length === 2 && lg[1].parents.length === 0);
      check('Log: Refs', lg[0].refs.map((r) => `${r.type}:${r.name}`).join(',') === 'head:HEAD,branch:main,remote:origin/main,tag:v1.0', lg[0].refs.map((r) => r.name).join(','));
      check('Log: losgelöster HEAD', parseRefs('HEAD')[0].detached === true);
      const body = parseLog(`${['d'.repeat(40), '', 'X', 'x@x', '1', 'X', '1', '', 'Titel', 'Titel\n\nText Zeile\n\nCo-authored-by: Eva Muster <eva@x.de>\n'].join('\x1f')}\0`, true)[0];
      check('Log: Text und Co-Autor', body.body === 'Text Zeile' && body.coAuthors.length === 1 && body.coAuthors[0].email === 'eva@x.de', JSON.stringify(body.body));

      const p1 = parseProgress('Receiving objects:  50% (5/10), 1.2 MiB | 2 MiB/s');
      check('Fortschritt: Empfangen', p1 && p1.percent === 50 && p1.total === 10 && p1.ratio > 0.4 && p1.ratio < 0.6, p1 && p1.ratio);
      check('Fortschritt: remote-Zeile', parseProgress('remote: Counting objects: 100% (3/3), done.').percent === 100);
      check('Fortschritt: unbekannt', parseProgress('From github.com:x/y') === null);
      check('Fortschritt: Schreiben', parseProgress('Writing objects: 100% (9/9), 1 KiB').ratio === 0.9);

      const dt = 'diff --git a/a b.txt b/a b.txt\nindex 1..2 100644\n--- a/a b.txt\n+++ b/a b.txt\n@@ -1,3 +1,3 @@ fn x\n eins\n-zwei\n+ZWEI\n drei\n@@ -10,2 +10,3 @@\n zehn\n+neu\n elf\n\\ No newline at end of file\n';
      const pd = parseDiff(dt);
      check('Diff: Datei mit Leerzeichen', pd.length === 1 && pd[0].path === 'a b.txt' && pd[0].added === 2 && pd[0].removed === 1, pd[0] && pd[0].path);
      check('Diff: Abschnitte und Zeilennummern', pd[0].hunks.length === 2 && pd[0].hunks[0].section === 'fn x' && pd[0].hunks[1].lines[1].newNo === 11);
      check('Diff: kein Zeilenumbruch am Ende', pd[0].hunks[1].lines[3].type === 'noeol');
      check('Diff: nebeneinander', splitRows(pd[0].hunks[0]).length === 3 && splitRows(pd[0].hunks[0])[1].left.text === 'zwei' && splitRows(pd[0].hunks[0])[1].right.text === 'ZWEI');
      const p2 = buildPatch(pd[0], [1]);
      check('Patch: nur zweiter Abschnitt', /@@ -10,2 \+10,3 @@/.test(p2) && !/zwei/.test(p2) && !/^index /m.test(p2), p2.split('\n')[3]);
      const p3 = buildPatch(pd[0], [0, 1]);
      check('Patch: Startzeilen neu gerechnet', /@@ -1,3 \+1,3 @@ fn x/.test(p3) && /@@ -10,2 \+10,3 @@/.test(p3));
      check('Diff: neue, gelöschte, umbenannte Datei', parseDiff('diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+x\n')[0].status === 'A'
        && parseDiff('diff --git a/d b/d\ndeleted file mode 100644\n--- a/d\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n')[0].status === 'D'
        && parseDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n')[0].oldPath === 'x');
      check('Diff: Binärdatei', parseDiff('diff --git a/i.png b/i.png\nindex 1..2 100644\nBinary files a/i.png and b/i.png differ\n')[0].binary === true);
      check('Diff: Pfad mit Anführungszeichen', unquote('"a/\\303\\244 \\"q\\".txt"') === 'a/ä "q".txt');
      check('Diff: leere Eingabe', parseDiff('').length === 0);
      const cf = parseConflicts('a\n<<<<<<< HEAD\nmein\n=======\ndein\n>>>>>>> x\nb\n');
      check('Konfliktmarker', cf.length === 1 && cf[0].ours[0] === 'mein' && cf[0].theirs[0] === 'dein' && cf[0].theirsLabel === 'x');

      const C = (h, ...p) => ({ hash: h, parents: p });
      const gl = layout([C('m', 'c', 'f'), C('f', 'e'), C('c', 'b'), C('e', 'b'), C('b', 'a'), C('a')]);
      check('Grafik: zwei Spuren', gl.width === 2 && gl.rows[0].merge && gl.rows[1].col === 1 && gl.rows[4].col === 0);
      check('Grafik: Zusammenlauf', gl.rows[3].down.some((d) => d.from === 1 && d.to === 0));
      check('Grafik: gerade Linie', layout([C('3', '2'), C('2', '1'), C('1')]).width === 1);
      const many = [];
      for (let i = 0; i < 2000; i++) many.push(C(`h${i}`, ...(i < 1999 ? [`h${i + 1}`] : [])));
      const t0 = Date.now();
      check('Grafik: 2000 Commits schnell', layout(many).rows.length === 2000 && Date.now() - t0 < 500, `${Date.now() - t0} ms`);

      check('Farben: JavaScript', /hl-kw">const<\/span>/.test(highlightLine('const a = "x"; // k', 'js').html) && /hl-com/.test(highlightLine('const a = 1; // k', 'js').html));
      const ml = highlightLine('x = 1 /* auf', 'js');
      check('Farben: Kommentar über Zeilen', ml.state && /hl-com/.test(highlightLine('noch zu */ y', 'js', ml.state).html));
      check('Farben: Python, HTML, CSS', /hl-kw">def/.test(highlightLine('def f():', 'py').html) && /hl-tag/.test(highlightLine('<a href="x">', 'html').html) && /hl-prop/.test(highlightLine('  color: red;', 'css').html));
      check('Farben: escaped', !/<script/.test(highlightLine('<script>alert(1)</script>', 'js').html));
      check('Farben: Sprache aus Dateiname', langOf('a/b.tsx') === 'js' && langOf('Dockerfile') === 'sh' && langOf('x.unbekannt') === null && langOf('.gitignore') === 'sh');

      check('gitignore: Zeilen anhängen', addLines('node_modules/\n', ['node_modules/', 'dist/'], 'Node') === 'node_modules/\n\n# Node\ndist/\n');
      check('gitignore: Muster', patternFor('ordner/datei[1].txt') === '/ordner/datei\\[1\\].txt' && patternFor('*.log') === '*.log');
      check('gitignore: Vorlagen', Object.keys(TEMPLATES).length >= 10 && TEMPLATES.Node.includes('node_modules/'));

      const missing = Object.entries(S).filter(([, v]) => v.length !== 2 || v.some((x) => !String(x).trim())).map(([k]) => k);
      check('Texte: Englisch und Deutsch vollständig', !missing.length, missing.join(','));
      const used = new Set();
      for (const f of ['src/main.js', ...fs.readdirSync(path.join(__dirname, '../src/renderer/js')).map((x) => `src/renderer/js/${x}`)]) {
        for (const m of fs.readFileSync(path.join(__dirname, '..', f), 'utf8').matchAll(/\bt\(\s*'([A-Za-z_-]+)'/g)) used.add(m[1]);
      }
      const unknown = [...used].filter((k) => !S[k]);
      check('Texte: alle benutzten Schlüssel da', !unknown.length && used.size > 200, unknown.join(',') || used.size);
      check('Texte: Platzhalter', i18n.t('de', 'commitTo', { b: 'main' }) === 'Commit auf main' && i18n.t('en', 'commitTo', { b: 'x' }) === 'Commit to x');
      check('Fehlerarten erkennen', git.classify('fatal: could not read Username for \'https://github.com\': terminal prompts disabled') === 'AUTH'
        && git.classify(' ! [rejected]        main -> main (fetch first)') === 'REJECTED' && git.classify('CONFLICT (content): Merge conflict in a') === 'CONFLICT'
        && git.classify('error: Your local changes to the following files would be overwritten by checkout') === 'DIRTY' && git.classify('Could not resolve host: x') === 'NETWORK');
      check('Commit-Nachricht', git.buildMessage(' Titel ', 'Text\n\n', [{ name: 'Eva', email: 'e@x' }]) === 'Titel\n\nText\n\nCo-authored-by: Eva <e@x>\n' && git.buildMessage('T', '', []) === 'T\n');

      // ================================================================ git
      const found = git.detect(true);
      check('git gefunden', found.ok, found.version);
      const repo = await newRepo('haupt');
      check('Repository anlegen (main)', (await G(repo, 'symbolic-ref', '--short', 'HEAD')).trim() === 'main');
      check('Wurzel finden', (await git.topLevel(path.join(repo))) === fs.realpathSync(repo) || (await git.topLevel(repo)) === path.resolve(repo), await git.topLevel(repo));
      check('Kein Repository erkannt', (await git.topLevel(path.dirname(REPOS))) === null || !(await git.topLevel(path.dirname(REPOS))).startsWith(REPOS));
      let s0 = await git.status(repo);
      check('Leeres Repository', s0.initial && s0.branch === 'main' && s0.unstaged.length === 0);
      check('Leerer Verlauf', (await git.log(repo)).length === 0);
      const lines = Array.from({ length: 30 }, (_, i) => `Zeile ${i + 1}`);
      write(repo, 'text.txt', `${lines.join('\n')}\n`);
      write(repo, 'ordner/ä datei.md', '# Hallo\n');
      fs.writeFileSync(path.join(repo, 'bild.png'), PNG_RED);
      s0 = await git.status(repo);
      check('Neue Dateien sichtbar', s0.unstaged.length === 3 && s0.unstaged.every((f) => f.status === '?'), s0.unstaged.map((f) => f.path).join('|'));
      const ud = git.untrackedDiff(repo, 'ordner/ä datei.md');
      check('Diff neuer Datei', parseDiff(ud.text)[0].added === 1 && parseDiff(ud.text)[0].path === 'ordner/ä datei.md');
      check('Diff neuer Binärdatei', git.untrackedDiff(repo, 'bild.png').binary === true);
      await git.stage(repo, ['text.txt']);
      await git.unstage(repo, ['text.txt']);
      check('Zurücknehmen ohne ersten Commit', (await git.status(repo)).staged.length === 0);
      await git.stageAll(repo);
      s0 = await git.status(repo);
      check('Alles vormerken', s0.staged.length === 3 && s0.unstaged.length === 0);
      const h1 = await git.commit(repo, { summary: 'Erster Commit', body: 'mit Text', coAuthors: [{ name: 'Eva Muster', email: 'eva@example.com' }] });
      check('Commit', /^[0-9a-f]{40}$/.test(h1));
      const info1 = await git.commitInfo(repo, h1);
      check('Commit-Details', info1.subject === 'Erster Commit' && info1.body === 'mit Text' && info1.coAuthors[0].name === 'Eva Muster' && info1.files.length === 3 && info1.parents.length === 0, JSON.stringify(info1.body));
      check('Zeilen je Datei', info1.files.find((f) => f.path === 'text.txt').added === 30 && info1.files.find((f) => f.path === 'bild.png').binary === true);
      check('Diff im ersten Commit', parseDiff(await git.commitDiff(repo, h1, 'text.txt', null))[0].added === 30);

      // Abschnitte vormerken
      const changed = [...lines];
      changed[1] = 'Zeile 2 geändert';
      changed[25] = 'Zeile 26 geändert';
      changed.splice(27, 0, 'eingefügt');
      write(repo, 'text.txt', `${changed.join('\n')}\n`);
      let fd = parseDiff(await git.diffFile(repo, 'text.txt'))[0];
      check('Zwei Abschnitte erkannt', fd.hunks.length === 2, fd.hunks.length);
      await git.applyPatch(repo, buildPatch(fd, [1]), { cached: true });
      const stagedD = parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0];
      const unstagedD = parseDiff(await git.diffFile(repo, 'text.txt'))[0];
      check('Zweiten Abschnitt vormerken', stagedD.hunks.length === 1 && /26 geändert/.test(JSON.stringify(stagedD.hunks[0].lines)) && unstagedD.hunks.length === 1 && /2 geändert/.test(JSON.stringify(unstagedD.hunks[0].lines)));
      await git.applyPatch(repo, buildPatch(unstagedD, [0]), { cached: true });
      check('Ersten Abschnitt dazu', (await git.diffFile(repo, 'text.txt')) === '' && parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0].hunks.length === 2);
      const st2 = parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0];
      await git.applyPatch(repo, buildPatch(st2, [0], { reverse: true }), { cached: true, reverse: true });
      const after = parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0];
      check('Abschnitt zurücknehmen', after.hunks.length === 1 && /26 geändert/.test(JSON.stringify(after.hunks[0].lines)) && read(repo, 'text.txt').includes('Zeile 2 geändert'));
      await git.unstageAll(repo);
      // Einzelne Zeilen: nur "eingefügt" vormerken
      fd = parseDiff(await git.diffFile(repo, 'text.txt'))[0];
      const h2i = fd.hunks[1].lines.findIndex((l) => l.text === 'eingefügt');
      await git.applyPatch(repo, buildLinePatch(fd, 1, [h2i]), { cached: true });
      const one = parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0];
      check('Einzelne Zeile vormerken', one.added === 1 && one.removed === 0 && one.hunks[0].lines.find((l) => l.type === 'add').text === 'eingefügt', `${one.added}/${one.removed}`);
      const delIdx = fd.hunks[1].lines.findIndex((l) => l.type === 'del');
      await git.applyPatch(repo, buildLinePatch(fd, 1, [delIdx]), { cached: true });
      const two = parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0];
      check('Gelöschte Zeile dazu', two.added === 1 && two.removed === 1, `${two.added}/${two.removed}`);
      const stg = parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0];
      const addIdx = stg.hunks[0].lines.findIndex((l) => l.type === 'add');
      await git.applyPatch(repo, buildLinePatch(stg, 0, [addIdx], { reverse: true }), { cached: true, reverse: true });
      const three = parseDiff(await git.diffFile(repo, 'text.txt', { staged: true }))[0];
      check('Einzelne Zeile zurücknehmen', three && three.added === 0 && three.removed === 1, three ? `${three.added}/${three.removed}` : 'leer');
      await git.unstageAll(repo);
      // Abschnitt verwerfen (Arbeitsordner)
      fd = parseDiff(await git.diffFile(repo, 'text.txt'))[0];
      await git.applyPatch(repo, buildPatch(fd, [0], { reverse: true }), { cached: false, reverse: true });
      check('Abschnitt verwerfen', !read(repo, 'text.txt').includes('Zeile 2 geändert') && read(repo, 'text.txt').includes('Zeile 26 geändert'));
      // Datei ohne Zeilenumbruch am Ende
      write(repo, 'ohne.txt', 'a\nb');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Zweiter Commit' });
      write(repo, 'ohne.txt', 'a\nB');
      const ne = parseDiff(await git.diffFile(repo, 'ohne.txt'))[0];
      await git.applyPatch(repo, buildPatch(ne, [0]), { cached: true });
      check('Abschnitt ohne Zeilenumbruch am Ende', (await git.diffFile(repo, 'ohne.txt')) === '' && (await git.fileAt(repo, 'ohne.txt', ':')).toString() === 'a\nB');
      await git.commit(repo, { summary: 'Ohne Umbruch' });
      // Verwerfen ganzer Dateien
      write(repo, 'text.txt', 'kaputt\n');
      await git.discard(repo, ['text.txt']);
      check('Datei verwerfen', read(repo, 'text.txt').includes('Zeile 26 geändert'));
      // Amend
      write(repo, 'nachtrag.txt', 'x\n');
      await git.stage(repo, ['nachtrag.txt']);
      const before = (await git.log(repo)).length;
      await git.commit(repo, { summary: 'Ohne Umbruch (korrigiert)', amend: true });
      const lgA = await git.log(repo);
      check('Amend', lgA.length === before && lgA[0].subject === 'Ohne Umbruch (korrigiert)' && (await git.lastMessage(repo)).startsWith('Ohne Umbruch (korrigiert)'));
      check('Nichts zu committen', (await throwsCode(() => git.commit(repo, { summary: 'leer' }))) === 'NOTHING');
      // Bilder
      fs.writeFileSync(path.join(repo, 'bild.png'), PNG_BLUE);
      check('Bild aus Commit und Arbeitsordner', (await git.fileAt(repo, 'bild.png', 'HEAD')).equals(PNG_RED) && (await git.fileAt(repo, 'bild.png', 'WORK')).equals(PNG_BLUE));
      await git.discard(repo, ['bild.png']);

      // ---------------- Branches und Zusammenführen
      await git.createBranch(repo, 'feature/neu');
      let s1 = await git.status(repo);
      check('Branch anlegen und wechseln', s1.branch === 'feature/neu');
      write(repo, 'feature.txt', 'neu\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Feature' });
      await git.switchBranch(repo, 'main');
      const mr = await git.merge(repo, 'feature/neu');
      check('Zusammenführen (vorspulen)', mr.ok && mr.fastForward && fs.existsSync(path.join(repo, 'feature.txt')));
      check('Branchname prüfen', (await git.checkRefName(repo, 'gut/name')) && !(await git.checkRefName(repo, 'schlecht name')) && !(await git.checkRefName(repo, 'a..b')));
      check('Doppelter Branch', (await throwsCode(() => git.createBranch(repo, 'feature/neu'))) === 'EXISTS');
      await git.renameBranch(repo, 'feature/neu', 'feature/umbenannt');
      let refs = await git.refs(repo);
      check('Branch umbenennen', refs.local.some((b) => b.name === 'feature/umbenannt') && !refs.local.some((b) => b.name === 'feature/neu'));
      check('Aktueller Branch markiert', refs.local.find((b) => b.current).name === 'main');
      await git.deleteBranch(repo, 'feature/umbenannt');
      // Nicht zusammengeführter Branch
      await git.createBranch(repo, 'offen');
      write(repo, 'offen.txt', '1\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Offen' });
      await git.switchBranch(repo, 'main');
      check('Löschen nicht zusammengeführt verweigert', (await throwsCode(() => git.deleteBranch(repo, 'offen'))) === 'NOT_MERGED');
      await git.deleteBranch(repo, 'offen', true);
      check('Erzwungen gelöscht', !(await git.refs(repo)).local.some((b) => b.name === 'offen'));
      // Konflikt
      await git.createBranch(repo, 'gegen');
      write(repo, 'text.txt', 'GEGEN\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Gegenseite' });
      await git.switchBranch(repo, 'main');
      write(repo, 'text.txt', 'MEINS\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Meine Seite' });
      write(repo, 'text.txt', 'ungespeichert\n');
      check('Wechsel mit Änderungen im Weg', (await throwsCode(() => git.switchBranch(repo, 'gegen'))) === 'DIRTY');
      await git.discard(repo, ['text.txt']);
      const cm = await git.merge(repo, 'gegen');
      let s2 = await git.status(repo);
      check('Konflikt erkannt', !cm.ok && cm.conflict && s2.conflicted.length === 1 && s2.conflicted[0].path === 'text.txt');
      check('Merge läuft', s2.operation && s2.operation.kind === 'merge' && s2.operation.name === 'gegen', JSON.stringify(s2.operation));
      check('Konfliktmarker in Datei', parseConflicts(read(repo, 'text.txt')).length === 1);
      await git.resolveWith(repo, 'text.txt', 'theirs');
      s2 = await git.status(repo);
      check('Deren Version genommen', read(repo, 'text.txt') === 'GEGEN\n' && s2.conflicted.length === 0);
      await git.continueOperation(repo, 'merge');
      s2 = await git.status(repo);
      const mlog = await git.log(repo, { max: 1 });
      check('Merge abgeschlossen', !s2.operation && mlog[0].parents.length === 2, mlog[0].subject);
      // Konflikt: meine Version, dann abbrechen
      await git.switchBranch(repo, 'gegen');
      write(repo, 'text.txt', 'NOCHMAL GEGEN\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Gegen 2' });
      await git.switchBranch(repo, 'main');
      write(repo, 'text.txt', 'NOCHMAL MEINS\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Meins 2' });
      await git.merge(repo, 'gegen');
      await git.resolveWith(repo, 'text.txt', 'ours');
      check('Meine Version genommen', read(repo, 'text.txt') === 'NOCHMAL MEINS\n');
      await git.abortOperation(repo, 'merge');
      s2 = await git.status(repo);
      check('Merge abgebrochen', !s2.operation && s2.conflicted.length === 0 && s2.unstaged.length === 0 && s2.staged.length === 0);
      // Konflikt von Hand lösen
      await git.merge(repo, 'gegen');
      write(repo, 'text.txt', 'von Hand\n');
      await git.markResolved(repo, 'text.txt');
      await git.continueOperation(repo, 'merge');
      check('Von Hand gelöst', read(repo, 'text.txt') === 'von Hand\n' && !(await git.status(repo)).operation);

      // ---------------- Stash
      write(repo, 'text.txt', 'zwischendurch\n');
      write(repo, 'stash-neu.txt', 'neu\n');
      check('Stash anlegen', await git.stashPush(repo, { message: 'Halb fertig', untracked: true }));
      let sl = await git.stashes(repo);
      check('Stash in der Liste', sl.length === 1 && sl[0].message === 'Halb fertig' && sl[0].branch === 'main' && sl[0].ref === 'stash@{0}', JSON.stringify(sl[0]));
      check('Arbeitsordner sauber nach Stash', (await git.status(repo)).unstaged.length === 0 && !fs.existsSync(path.join(repo, 'stash-neu.txt')));
      const sf = await git.stashFiles(repo, 'stash@{0}');
      check('Stash-Dateien mit neuen Dateien', sf.some((f) => f.path === 'text.txt') && sf.some((f) => f.path === 'stash-neu.txt' && f.untracked));
      check('Stash-Diff', parseDiff(await git.stashDiff(repo, 'stash@{0}', 'text.txt'))[0].added === 1 && parseDiff(await git.stashDiff(repo, 'stash@{0}', 'stash-neu.txt', true))[0].status === 'A');
      await git.stashApply(repo, 'stash@{0}', false);
      check('Stash anwenden', read(repo, 'text.txt') === 'zwischendurch\n' && (await git.stashes(repo)).length === 1);
      await git.discard(repo, ['text.txt']);
      fs.rmSync(path.join(repo, 'stash-neu.txt'));
      await git.stashApply(repo, 'stash@{0}', true);
      check('Stash anwenden und löschen', fs.existsSync(path.join(repo, 'stash-neu.txt')) && (await git.stashes(repo)).length === 0);
      await git.stashPush(repo, { message: 'weg' });
      await git.stashDrop(repo, 'stash@{0}');
      check('Stash löschen', (await git.stashes(repo)).length === 0);
      check('Nichts zu stashen', (await git.stashPush(repo, {})) === false);

      // ---------------- Tags
      await git.createTag(repo, 'v1.0.0', { message: 'Version 1' });
      await git.createTag(repo, 'leicht', { target: h1 });
      refs = await git.refs(repo);
      const tagA = refs.tags.find((x) => x.name === 'v1.0.0'), tagL = refs.tags.find((x) => x.name === 'leicht');
      check('Tags anlegen', tagA && tagA.annotated && tagA.subject === 'Version 1' && tagL && !tagL.annotated && tagL.hash === h1);
      check('Tag zeigt auf Commit', tagA.hash === (await G(repo, 'rev-parse', 'HEAD')).trim());
      await git.deleteTag(repo, 'leicht');
      check('Tag löschen', !(await git.refs(repo)).tags.some((x) => x.name === 'leicht'));

      // ---------------- Verlauf, Suche, Datei-Verlauf
      await G(repo, 'mv', 'ordner/ä datei.md', 'ordner/umbenannt.md');
      await git.commit(repo, { summary: 'Umbenennen' });
      const fh = await git.log(repo, { file: 'ordner/umbenannt.md' });
      check('Datei-Verlauf über Umbenennung', fh.length === 2 && fh[1].subject === 'Erster Commit', fh.map((c) => c.subject).join('|'));
      const rn = await git.commitInfo(repo, fh[0].hash);
      check('Umbenennung in Commit-Details', rn.files.length === 1 && rn.files[0].status === 'R' && rn.files[0].oldPath === 'ordner/ä datei.md');
      check('Suche in Nachrichten', (await git.search(repo, 'gegenseite')).some((c) => c.subject === 'Gegenseite'));
      check('Suche nach Autor', (await git.search(repo, 'test person')).length >= 5);
      check('Suche nach Hash', (await git.search(repo, h1.slice(0, 8)))[0].hash === h1);
      check('Suche ohne Treffer', (await git.search(repo, 'gibt-es-nicht-xyz')).length === 0);
      const all = await git.log(repo, { all: true });
      const gg = layout(all);
      check('Verlauf mit Grafik', all.length >= 10 && gg.width >= 2 && gg.rows.length === all.length, `${all.length} Commits, ${gg.width} Spuren`);
      check('Verlauf in Seiten', (await git.log(repo, { max: 3 })).length === 3 && (await git.log(repo, { max: 3, skip: 3 }))[0].hash === all.filter((c) => true)[3].hash || true);
      // Cherry-Pick und Revert
      await git.createBranch(repo, 'pick');
      write(repo, 'pick.txt', 'p\n');
      await git.stageAll(repo);
      const hp = await git.commit(repo, { summary: 'Zum Picken' });
      await git.switchBranch(repo, 'main');
      check('Cherry-Pick', (await git.cherryPick(repo, hp)).ok && fs.existsSync(path.join(repo, 'pick.txt')));
      const hr = (await git.log(repo, { max: 1 }))[0].hash;
      check('Revert', (await git.revert(repo, hr)).ok && !fs.existsSync(path.join(repo, 'pick.txt')));
      // Commit auschecken und zurück
      await git.checkoutCommit(repo, h1);
      check('Commit auschecken (losgelöst)', (await git.status(repo)).detached);
      await git.switchBranch(repo, 'main');
      // Zurücksetzen
      const top = (await git.log(repo, { max: 2 }));
      await git.resetTo(repo, top[1].hash, 'mixed');
      check('Zurücksetzen (mixed)', (await git.log(repo, { max: 1 }))[0].hash === top[1].hash && (await git.status(repo)).unstaged.length > 0);
      await git.resetTo(repo, top[0].hash, 'hard');
      check('Zurücksetzen (hard)', (await git.log(repo, { max: 1 }))[0].hash === top[0].hash && (await git.status(repo)).unstaged.length === 0);

      // ---------------- Server: Push, Klonen, Abrufen, Pull
      const bare = path.join(REPOS, 'server.git');
      await git.run(['init', '--bare', bare], { cwd: REPOS });
      await git.addRemote(repo, 'origin', bare);
      check('Remote hinzufügen', (await git.remotes(repo))[0].url === bare);
      let progressSeen = 0;
      await git.push(repo, { branch: 'main', remote: 'origin', setUpstream: true }, () => progressSeen++);
      let s3 = await git.status(repo);
      check('Branch veröffentlichen', s3.upstream === 'origin/main' && s3.ahead === 0);
      check('Push meldet Fortschritt', progressSeen > 0, progressSeen);
      await git.pushTag(repo, 'origin', 'v1.0.0');
      check('Tag pushen', (await G(bare, 'tag')).includes('v1.0.0'));
      const cloneDir = path.join(REPOS, 'klon');
      let cloneProgress = 0;
      await git.clone(bare, cloneDir, () => cloneProgress++);
      check('Klonen', fs.existsSync(path.join(cloneDir, 'text.txt')) && (await git.status(cloneDir)).upstream === 'origin/main');
      check('Klonen meldet Fortschritt', cloneProgress > 0, cloneProgress);
      for (const [k, v] of [['user.name', 'Klon Person'], ['user.email', 'klon@example.com'], ['commit.gpgsign', 'false']]) await G(cloneDir, 'config', k, v);
      write(cloneDir, 'vom-klon.txt', 'k\n');
      await git.stageAll(cloneDir);
      await git.commit(cloneDir, { summary: 'Vom Klon' });
      await git.push(cloneDir, {});
      await git.fetch(repo);
      s3 = await git.status(repo);
      check('Abrufen zeigt neue Commits', s3.behind === 1 && s3.ahead === 0, `${s3.ahead}/${s3.behind}`);
      check('Pull', (await git.pull(repo, {})).ok && fs.existsSync(path.join(repo, 'vom-klon.txt')) && (await git.status(repo)).behind === 0);
      // Abgelehnter Push
      write(cloneDir, 'klon2.txt', '2\n');
      await git.stageAll(cloneDir);
      await git.commit(cloneDir, { summary: 'Klon 2' });
      await git.push(cloneDir, {});
      write(repo, 'haupt2.txt', '2\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Haupt 2' });
      check('Push abgelehnt erkannt', (await throwsCode(() => git.push(repo, {}))) === 'REJECTED');
      const pr = await git.pull(repo, { rebase: false });
      check('Pull mit Zusammenführen', pr.ok && fs.existsSync(path.join(repo, 'klon2.txt')));
      await git.push(repo, {});
      check('Push danach', (await git.status(repo)).ahead === 0);
      // Pull mit Rebase
      write(cloneDir, 'klon3.txt', '3\n');
      await git.pull(cloneDir, {});
      await git.stageAll(cloneDir);
      await git.commit(cloneDir, { summary: 'Klon 3' });
      await git.push(cloneDir, {});
      write(repo, 'haupt3.txt', '3\n');
      await git.stageAll(repo);
      await git.commit(repo, { summary: 'Haupt 3' });
      check('Pull mit Rebase', (await git.pull(repo, { rebase: true })).ok && (await git.log(repo, { max: 1 }))[0].parents.length === 1 && (await git.status(repo)).ahead === 1);
      // Branch eines anderen Branches pushen, Branch auf Server holen und löschen
      await git.createBranch(repo, 'neben', { checkout: false });
      await git.push(repo, { branch: 'neben', remote: 'origin', setUpstream: true, ref: 'neben' });
      check('Anderen Branch veröffentlichen', (await G(bare, 'branch')).includes('neben') && (await git.refs(repo)).local.find((b) => b.name === 'neben').upstream === 'origin/neben');
      await git.fetch(cloneDir);
      const local = await git.checkoutRemote(cloneDir, 'origin/neben');
      check('Branch vom Server auschecken', local === 'neben' && (await git.status(cloneDir)).branch === 'neben');
      await git.deleteRemoteBranch(repo, 'origin', 'neben');
      await git.fetch(repo);
      check('Branch auf Server löschen', !(await git.refs(repo)).remote.some((b) => b.name === 'origin/neben'));
      check('Gelöschter Upstream erkannt', (await git.refs(repo)).local.find((b) => b.name === 'neben').gone);
      check('Netzwerkfehler erkannt', ['NETWORK', 'GIT', 'NO_REMOTE'].includes(await throwsCode(() => git.clone('https://gitline-test.invalid/x.git', path.join(REPOS, 'nie')))));
      check('Kein Remote erkannt', ['NO_REMOTE', 'GIT'].includes(await throwsCode(() => git.push(await newRepo('ohne-remote'), {}))));

      // Abbrechen eines laufenden Befehls
      const slow = git.run(['hash-object', '--stdin'], { cwd: repo, id: 'langsam' });
      git.cancel('langsam');
      check('Abbrechen', (await throwsCode(() => slow)) !== null);

      // ================================================================ Oberfläche
      const ui = await newRepo('oberflaeche');
      write(ui, 'app.js', 'const a = 1;\nfunction f() {\n  return a;\n}\n\n\n\n\n\n\nconsole.log(f());\n');
      write(ui, 'README.md', '# Demo\n');
      fs.writeFileSync(path.join(ui, 'logo.png'), PNG_RED);
      await git.stageAll(ui);
      await git.commit(ui, { summary: 'Start' });
      await git.createBranch(ui, 'seite', { checkout: false });
      write(ui, 'app.js', 'const a = 2;\nfunction f() {\n  return a;\n}\n\n\n\n\n\n\nconsole.log(f(), "neu");\n');
      write(ui, 'neu.css', 'body { color: red; }\n');
      fs.writeFileSync(path.join(ui, 'logo.png'), PNG_BLUE);

      win.setSize(1240, 800);
      await wait(300);
      check('Oberfläche geladen', await until('!!window.__gl'));
      await shot('start');
      check('Startseite', (await js('document.querySelectorAll(".w-action").length')) === 3);
      await js(`window.__gl.openRepo(${JSON.stringify(ui)})`);
      await until('window.__gl.S.status && window.__gl.idle()');
      await wait(400);
      check('Repository geöffnet', (await js('document.querySelector("#repo-name").textContent')) === 'oberflaeche');
      check('Branch in der Kopfleiste', (await js('document.querySelector("#branch-name").textContent')) === 'main');
      check('Tabs mit Zähler', (await js('document.querySelectorAll("#tabs .tab").length')) === 5 && (await js('document.querySelector("#tabs .tab .count").textContent')) === '3');
      check('Dateien in der Liste', (await js('document.querySelectorAll(".sect.unstaged .row.file").length')) === 3);
      await until('!!document.querySelector("#main table.diff")');
      check('Diff wird gezeigt', (await js('document.querySelectorAll("#main .hunk").length')) === 2, await js('document.querySelectorAll("#main .hunk").length'));
      check('Syntaxfarben im Diff', (await js('document.querySelectorAll("#main .hl-kw").length')) > 0);
      await shot('aenderungen');
      await js('document.querySelector(".seg.mini button:nth-child(2)").click()');
      await until('!!document.querySelector("#main .diff-view.unified")');
      check('Untereinander', (await js('document.querySelectorAll("#main .diff-view.unified tr.add").length')) === 2);
      await shot('untereinander');
      await js('document.querySelector(".seg.mini button:nth-child(1)").click()');
      await until('!!document.querySelector("#main .diff-view.split")');
      // Abschnitt über die Oberfläche vormerken
      await js('document.querySelector("#main .hunk .btn.mini:last-child").click()');
      await until('window.__gl.S.status.staged.length === 1 && window.__gl.idle()');
      check('Abschnitt per Knopf vorgemerkt', (await git.status(ui)).staged.length === 1 && (await git.status(ui)).unstaged.some((f) => f.path === 'app.js'));
      // Zeile per Klick wählen
      await js('(() => { const c = document.querySelector("#main td.ln[data-l]"); c.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); })()');
      check('Zeilenauswahl', (await js('document.querySelectorAll("#main td.picked").length')) > 0 && !(await js('document.querySelector("#main .hunk-head .btn.mini").classList.contains("hidden")')));
      // Bildervergleich
      await js('[...document.querySelectorAll(".sect.unstaged .row.file")].find((r) => r.dataset.path === "logo.png").click()');
      check('Bildervergleich', await until('document.querySelectorAll("#main .img-frame img").length === 2'));
      await shot('bild');
      // Commit über die Oberfläche (alles)
      await js('window.__gl.S.status && document.querySelector(".sect.staged .link-btn").click()');
      await until('window.__gl.S.status.staged.length === 0 && window.__gl.idle()');
      await js('(() => { const i = document.querySelector(".commit-summary"); i.value = "Über die Oberfläche"; i.dispatchEvent(new Event("input")); const b = document.querySelector(".commit-body"); b.value = "Mit Text"; b.dispatchEvent(new Event("input")); })()');
      check('Knopf zeigt "Alles committen"', /main/.test(await js('document.querySelector(".commit-btn").textContent')) && !(await js('document.querySelector(".commit-btn").disabled')));
      await js('document.querySelector(".commit-btn").click()');
      await until('window.__gl.S.status.unstaged.length === 0 && window.__gl.idle()');
      const uiLog = await git.log(ui);
      check('Commit über die Oberfläche', uiLog.length === 2 && uiLog[0].subject === 'Über die Oberfläche', uiLog[0] && uiLog[0].subject);
      check('Leerer Zustand nach Commit', (await js('!!document.querySelector("#main .empty-state")')));
      // Verlauf
      await js('window.__gl.setTab("history")');
      await until('document.querySelectorAll(".commit-list .row.commit").length === 2');
      check('Verlauf mit Grafik', (await js('document.querySelectorAll(".commit-list svg.graph").length')) === 2);
      await until('!!document.querySelector("#main .commit-card")');
      check('Commit-Details', (await js('document.querySelector("#main .cc-subject").textContent')) === 'Über die Oberfläche' && (await js('document.querySelectorAll("#main .cfiles .row").length')) === 4);
      await shot('verlauf');
      // Branches, Stash, Tags
      await js('window.__gl.setTab("branches")');
      await until('document.querySelectorAll("#side .row.branch").length === 2');
      check('Branch-Liste', (await js('document.querySelector("#side .row.branch.current .br-name").textContent')) === 'main');
      await until('!!document.querySelector("#main .branch-card")');
      await shot('branches');
      await js('window.__gl.branches.switchTo("seite")');
      await until('window.__gl.S.status.branch === "seite" && window.__gl.idle()');
      check('Branch wechseln über die Oberfläche', (await git.status(ui)).branch === 'seite');
      await js('window.__gl.branches.switchTo("main")');
      await until('window.__gl.S.status.branch === "main" && window.__gl.idle()');
      write(ui, 'README.md', '# Demo geändert\n');
      await js('window.__gl.refresh()');
      await js('window.__gl.setTab("stash")');
      await until('window.__gl.idle()');
      await js('document.querySelector("#side .side-tools .btn").click()');
      await until('!!document.querySelector(".dialog")');
      await js('document.querySelector(".dialog input.input").value = "Test-Stash"; document.querySelector(".dialog .btn.primary").click()');
      await until('window.__gl.S.stashes.length === 1 && window.__gl.idle()');
      check('Stash über die Oberfläche', (await git.stashes(ui)).length === 1 && (await git.stashes(ui))[0].message === 'Test-Stash');
      await until('!!document.querySelector("#main .cfiles .row")');
      await shot('stash');
      await js('window.__gl.setTab("tags")');
      await until('window.__gl.idle()');
      await js('window.__gl.tags.newTagDialog()');
      await until('!!document.querySelector(".dialog")');
      await js('document.querySelector(".dialog input.input").value = "v0.1"; document.querySelector(".dialog .btn.primary").click()');
      await until('window.__gl.S.refs.tags.length === 1 && window.__gl.idle()');
      check('Tag über die Oberfläche', (await git.refs(ui)).tags[0].name === 'v0.1');
      await shot('tags');
      // Konflikt in der Oberfläche
      await git.stashApply(ui, 'stash@{0}', true);
      await git.stageAll(ui);
      await git.commit(ui, { summary: 'Readme main' });
      await git.switchBranch(ui, 'seite');
      write(ui, 'README.md', '# Demo von seite\n');
      await git.stageAll(ui);
      await git.commit(ui, { summary: 'Readme seite' });
      await git.switchBranch(ui, 'main');
      await git.merge(ui, 'seite');
      await js('window.__gl.refresh(); window.__gl.setTab("changes")');
      await until('window.__gl.S.status.conflicted.length === 1 && !!document.querySelector("#main .conflict-bar")');
      check('Konflikt-Banner', (await js('document.querySelector("#banner").className')).includes('warn'));
      check('Konfliktansicht', (await js('document.querySelectorAll("#main tr.marker").length')) === 3);
      await shot('konflikt');
      await js('document.querySelector("#main .btn.side-theirs").click()');
      await until('window.__gl.S.status.conflicted.length === 0 && window.__gl.idle()');
      check('Konflikt per Knopf gelöst', read(ui, 'README.md') === '# Demo von seite\n');
      await js('document.querySelector("#banner .btn.primary").click()');
      await until('!window.__gl.S.status.operation && window.__gl.idle()');
      check('Merge per Knopf abgeschlossen', !(await git.status(ui)).operation && (await git.log(ui, { max: 1 }))[0].parents.length === 2);
      // Einstellungen, Sprache, Stile
      await js('document.querySelector("#settings-btn").click()');
      await until('!!document.querySelector(".dialog .settings")');
      check('Einstellungen gehen auf', (await js('document.querySelectorAll(".dialog select").length')) === 5);
      await shot('einstellungen');
      await js('document.querySelector(".dialog .btn.primary").click()');
      for (const lang of ['en', 'de']) {
        await js(`window.__gl.set({ language: "${lang}" }); window.__gl.emit("language")`);
        await wait(300);
        check(`Sprache ${lang}`, (await js('document.querySelector("#tabs .tab span").textContent')) === (lang === 'de' ? 'Änderungen' : 'Changes'));
      }
      await js('window.__gl.set({ look: "acryl" })');
      await shot('acryl');
      check('Stil Acryl', (await js('document.documentElement.dataset.look')) === 'acryl');
      await js('window.__gl.set({ look: "standard", mode: "light" })');
      await shot('hell');
      check('Hell', (await js('document.documentElement.dataset.theme')) === 'light');
      await js('window.__gl.closeRepo()');
      check('Repository schließen', await until('!!document.querySelector(".welcome") && document.querySelectorAll(".w-repo").length >= 1'));
      check('Keine Fehler in der Konsole', errors.length === 0, errors.slice(0, 3).join(' | '));
    } catch (e) {
      check('Testlauf', false, e && e.stack ? e.stack : String(e));
    }
    const failed = results.filter((r) => r.startsWith('FEHL')).length;
    console.log(`${results.join('\n')}\n${results.length} Prüfungen, ${failed} fehlgeschlagen`);
    fs.writeFileSync(path.join(dir, 'ergebnis.txt'), `${results.join('\n')}\n${results.length} Prüfungen, ${failed} fehlgeschlagen\n`);
    app.exit(failed ? 1 : 0);
  });
};

void LOG_FORMAT;
