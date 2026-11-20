'use strict';

// Liest "git status --porcelain=v2 -z --branch". Läuft im Hauptprozess und im Selbsttest.
// X = Stand im Index (vorgemerkt), Y = Stand im Arbeitsordner. "." heißt unverändert.

function parseStatus(text) {
  const st = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, detached: false, initial: false, staged: [], unstaged: [], conflicted: [] };
  const parts = String(text || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    if (s.startsWith('# ')) {
      const [key, ...rest] = s.slice(2).split(' ');
      const val = rest.join(' ');
      if (key === 'branch.oid') {
        st.initial = val === '(initial)';
        st.oid = st.initial ? null : val;
      } else if (key === 'branch.head') {
        st.detached = val === '(detached)';
        st.branch = st.detached ? null : val;
      } else if (key === 'branch.upstream') st.upstream = val;
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(val);
        if (m) {
          st.ahead = +m[1];
          st.behind = +m[2];
        }
      }
      continue;
    }
    const kind = s[0];
    if (kind === '?') {
      st.unstaged.push({ path: s.slice(2), status: '?' });
    } else if (kind === '1' || kind === '2') {
      const f = s.split(' ');
      const xy = f[1];
      const sub = f[2];
      const file = f.slice(kind === '1' ? 8 : 9).join(' ');
      let oldPath = null;
      if (kind === '2') {
        oldPath = parts[i + 1];
        i++;
      }
      const submodule = sub[0] === 'S';
      if (xy[0] !== '.') st.staged.push({ path: file, status: xy[0], oldPath: xy[0] === 'R' || xy[0] === 'C' ? oldPath : null, submodule });
      if (xy[1] !== '.') st.unstaged.push({ path: file, status: xy[1], submodule });
    } else if (kind === 'u') {
      const f = s.split(' ');
      st.conflicted.push({ path: f.slice(10).join(' '), status: 'U', xy: f[1] });
    }
  }
  const byPath = (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
  st.staged.sort(byPath);
  st.unstaged.sort(byPath);
  st.conflicted.sort(byPath);
  return st;
}

/** Bedeutung eines Konflikts: wer hat was gemacht */
function conflictKind(xy) {
  return { DD: 'bothDeleted', AU: 'addedByUs', UD: 'deletedByThem', UA: 'addedByThem', DU: 'deletedByUs', AA: 'bothAdded', UU: 'bothModified' }[xy] || 'bothModified';
}

module.exports = { parseStatus, conflictKind };
