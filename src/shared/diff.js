'use strict';

// Unified Diffs lesen und daraus Patches für einzelne Abschnitte (Hunks) bauen.
// Wird im Hauptprozess, in der Oberfläche und im Selbsttest benutzt.

/** "a/pfad" oder "\"a/p\\303\\244th\"" -> Pfad ohne a/ bzw. b/ */
function unquote(s) {
  s = String(s || '').replace(/\t.*$/, '');
  if (s.startsWith('"') && s.endsWith('"')) {
    const bytes = [];
    const body = s.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch !== '\\') {
        for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
        continue;
      }
      const n = body[++i];
      if (/[0-7]/.test(n)) {
        bytes.push(parseInt(body.slice(i, i + 3), 8));
        i += 2;
      } else bytes.push({ n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }[n] ?? n.charCodeAt(0));
    }
    s = Buffer.from(bytes).toString('utf8');
  }
  return s;
}
const stripPrefix = (p) => (p === '/dev/null' ? null : p.replace(/^[ab]\//, ''));

/** Pfade aus "diff --git a/x b/y" (vorläufig; genauer kommen sie aus ---/+++ bzw. rename from/to) */
function gitHeaderNames(line) {
  const rest = line.replace(/^diff --git /, '');
  if (rest === line) return null;
  const q = /^("(?:[^"\\]|\\.)*"|[^"]\S*) ("(?:[^"\\]|\\.)*"|\S.*)$/.exec(rest);
  if (rest.includes('"') && q) return [stripPrefix(unquote(q[1])), stripPrefix(unquote(q[2]))];
  // gleiche Namen (der Normalfall, auch mit Leerzeichen): genau in der Mitte geteilt
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === ' ' && rest.slice(2, mid) === rest.slice(mid + 3)) return [rest.slice(2, mid), rest.slice(mid + 3)];
  const m = /^a\/(.+?) b\/(.+)$/.exec(rest);
  return m ? [m[1], m[2]] : null;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Ganzen Diff (eine oder mehrere Dateien) lesen */
function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldNo = 0, newNo = 0;
  const src = String(text || '');
  const rows = src.split('\n');
  if (rows.length && rows[rows.length - 1] === '') rows.pop();
  const startFile = (line) => {
    file = { oldPath: null, newPath: null, path: null, status: 'M', binary: false, header: [], hunks: [], added: 0, removed: 0 };
    files.push(file);
    hunk = null;
    if (line != null) {
      file.header.push(line);
      const names = gitHeaderNames(line);
      if (names) [file.oldPath, file.newPath] = names;
    }
  };
  for (const line of rows) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      startFile(line);
      continue;
    }
    if (!file) {
      if (line.startsWith('--- ') || line.startsWith('@@ ')) startFile(null);
      else continue;
    }
    if (!hunk || (line.startsWith('@@ ') && HUNK_RE.test(line))) {
      const m = HUNK_RE.exec(line);
      if (m) {
        hunk = { header: line, oldStart: +m[1], oldCount: m[2] == null ? 1 : +m[2], newStart: +m[3], newCount: m[4] == null ? 1 : +m[4], section: m[5] || '', lines: [] };
        oldNo = hunk.oldStart;
        newNo = hunk.newStart;
        file.hunks.push(hunk);
        continue;
      }
      if (hunk) {
        // nicht erkannte Zeile nach einem Abschnitt: ignorieren
        continue;
      }
      file.header.push(line);
      if (line.startsWith('--- ')) file.oldPath = stripPrefix(unquote(line.slice(4)));
      else if (line.startsWith('+++ ')) file.newPath = stripPrefix(unquote(line.slice(4)));
      else if (line.startsWith('new file mode')) file.status = 'A';
      else if (line.startsWith('deleted file mode')) file.status = 'D';
      else if (line.startsWith('rename from ')) {
        file.oldPath = unquote(line.slice(12));
        file.status = 'R';
      } else if (line.startsWith('rename to ')) file.newPath = unquote(line.slice(10));
      else if (line.startsWith('copy from ')) {
        file.oldPath = unquote(line.slice(10));
        file.status = 'C';
      } else if (line.startsWith('copy to ')) file.newPath = unquote(line.slice(8));
      else if (/^Binary files .* differ$/.test(line) || line.startsWith('GIT binary patch')) file.binary = true;
      else if (line.startsWith('old mode ')) file.oldMode = line.slice(9);
      else if (line.startsWith('new mode ')) file.newMode = line.slice(9);
      continue;
    }
    const c = line[0];
    if (c === '+') {
      hunk.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ });
      file.added++;
    } else if (c === '-') {
      hunk.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ });
      file.removed++;
    } else if (c === '\\') hunk.lines.push({ type: 'noeol', text: line.slice(2) });
    else hunk.lines.push({ type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  for (const f of files) {
    if (f.oldPath == null && f.newPath != null) f.status = 'A';
    if (f.newPath == null && f.oldPath != null) f.status = 'D';
    f.path = f.newPath || f.oldPath;
  }
  return files;
}

/**
 * Patch nur mit ausgewählten Abschnitten (Indizes) einer Datei bauen.
 * reverse=false: der Patch wird vorwärts auf die alte Seite angewendet (Vormerken) -> neue Startzeilen neu rechnen.
 * reverse=true: wird rückwärts angewendet (Zurücknehmen/Verwerfen) -> alte Startzeilen neu rechnen.
 */
function buildPatch(file, indices, { reverse = false } = {}) {
  const pick = new Set(indices);
  const header = file.header.filter((l) => !l.startsWith('index ')).join('\n');
  let delta = 0;
  const parts = [];
  file.hunks.forEach((h, i) => {
    if (!pick.has(i)) return;
    let { oldStart, newStart } = h;
    const { oldCount, newCount } = h;
    if (!reverse) {
      const first = oldCount ? oldStart : oldStart + 1;
      const n = first + delta;
      newStart = newCount ? n : n - 1;
      delta += newCount - oldCount;
    } else {
      const first = newCount ? newStart : newStart + 1;
      const o = first - delta;
      oldStart = oldCount ? o : o - 1;
      delta += newCount - oldCount;
    }
    const head = `@@ -${oldStart}${oldCount === 1 ? '' : `,${oldCount}`} +${newStart}${newCount === 1 ? '' : `,${newCount}`} @@${h.section ? ` ${h.section}` : ''}`;
    const body = h.lines.map((l) => (l.type === 'add' ? '+' : l.type === 'del' ? '-' : l.type === 'noeol' ? '\\ ' : ' ') + l.text);
    parts.push([head, ...body].join('\n'));
  });
  if (!parts.length) return '';
  return `${header}\n${parts.join('\n')}\n`;
}

/**
 * Patch nur mit ausgewählten Zeilen eines Abschnitts (für "Zeilen vormerken").
 * Nicht gewählte + werden weggelassen, nicht gewählte - werden zu Kontext. Rückwärts genau umgekehrt.
 */
function buildLinePatch(file, hunkIndex, lineIndices, { reverse = false } = {}) {
  const h = file.hunks[hunkIndex];
  if (!h) return '';
  const pick = new Set(lineIndices);
  const out = [];
  let oldCount = 0, newCount = 0, changed = false, lastKept = true;
  const keep = (sign, text, o, n) => {
    out.push(sign + text);
    oldCount += o;
    newCount += n;
    lastKept = true;
  };
  h.lines.forEach((l, i) => {
    const chosen = pick.has(i);
    if (l.type === 'noeol') {
      if (lastKept) out.push(`\\ ${l.text}`);
    } else if (l.type === 'ctx') keep(' ', l.text, 1, 1);
    else if (l.type === 'add') {
      if (chosen) {
        keep('+', l.text, 0, 1);
        changed = true;
      } else if (reverse) keep(' ', l.text, 1, 1);
      else lastKept = false;
    } else if (l.type === 'del') {
      if (chosen) {
        keep('-', l.text, 1, 0);
        changed = true;
      } else if (!reverse) keep(' ', l.text, 1, 1);
      else lastKept = false;
    }
  });
  if (!changed) return '';
  let oldStart, newStart;
  if (!reverse) {
    oldStart = h.oldStart;
    const first = h.oldCount ? h.oldStart : h.oldStart + 1;
    newStart = newCount ? first : first - 1;
  } else {
    newStart = h.newStart;
    const first = h.newCount ? h.newStart : h.newStart + 1;
    oldStart = oldCount ? first : first - 1;
  }
  const header = file.header.filter((l) => !l.startsWith('index ')).join('\n');
  return `${header}\n@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${out.join('\n')}\n`;
}

/** Paare für die Ansicht nebeneinander: gelöschte und neue Zeilen eines Blocks nebeneinander */
function splitRows(hunk) {
  const rows = [];
  let dels = [], adds = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) rows.push({ left: dels[i] || null, right: adds[i] || null });
    dels = [];
    adds = [];
  };
  hunk.lines.forEach((l, i) => {
    const x = { ...l, index: i };
    if (l.type === 'del') {
      if (adds.length) flush();
      dels.push(x);
    } else if (l.type === 'add') adds.push(x);
    else if (l.type === 'noeol') {
      // gehört zur Zeile davor
      const prev = adds.length ? adds[adds.length - 1] : dels.length ? dels[dels.length - 1] : rows.length ? (rows[rows.length - 1].right || rows[rows.length - 1].left) : null;
      if (prev) prev.noeol = true;
    } else {
      flush();
      rows.push({ left: x, right: x, ctx: true });
    }
  });
  flush();
  return rows;
}

/** Konfliktmarker in einer Datei finden */
function parseConflicts(text) {
  const out = [];
  const ls = String(text || '').split('\n');
  let cur = null;
  ls.forEach((l, i) => {
    if (/^<{7}( |$)/.test(l)) cur = { start: i, ours: [], base: [], theirs: [], oursLabel: l.slice(8), mode: 'ours' };
    else if (cur && /^\|{7}( |$)/.test(l)) cur.mode = 'base';
    else if (cur && /^={7}$/.test(l)) cur.mode = 'theirs';
    else if (cur && /^>{7}( |$)/.test(l)) {
      cur.end = i;
      cur.theirsLabel = l.slice(8);
      delete cur.mode;
      out.push(cur);
      cur = null;
    } else if (cur) cur[cur.mode].push(l);
  });
  return out;
}

module.exports = { parseDiff, buildPatch, buildLinePatch, splitRows, parseConflicts, unquote };
