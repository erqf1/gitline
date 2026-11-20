'use strict';

// Ausgabe von "git log -z --format=LOG_FORMAT" lesen
// Felder: Hash, Eltern, Autor, E-Mail, Zeit (Autor), Committer, Zeit (Commit), Refs, Betreff
const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%D%x1f%s';

function parseRefs(d) {
  const out = [];
  // Mit --decorate=full kommen volle Namen (refs/heads/..., refs/remotes/..., tag: refs/tags/...);
  // kurze Namen werden auch verstanden (dann gilt "a/b" als Server-Branch, wie früher)
  const one = (r, current) => {
    if (r.startsWith('refs/heads/')) out.push({ type: 'branch', name: r.slice(11), current });
    else if (r.startsWith('refs/remotes/')) out.push({ type: 'remote', name: r.slice(13) });
    else if (r.startsWith('refs/tags/')) out.push({ type: 'tag', name: r.slice(10) });
    else if (r.startsWith('refs/')) return;
    else if (r.includes('/') && !current) out.push({ type: 'remote', name: r });
    else out.push({ type: 'branch', name: r, current });
  };
  for (let r of String(d || '').split(', ')) {
    r = r.trim();
    if (!r) continue;
    if (r.startsWith('HEAD -> ')) {
      out.push({ type: 'head', name: 'HEAD' });
      one(r.slice(8), true);
    } else if (r === 'HEAD') out.push({ type: 'head', name: 'HEAD', detached: true });
    else if (r.startsWith('tag: ')) {
      const n = r.slice(5);
      out.push({ type: 'tag', name: n.startsWith('refs/tags/') ? n.slice(10) : n });
    } else one(r, false);
  }
  // origin/HEAD braucht niemand
  return out.filter((x) => !(x.type === 'remote' && /\/HEAD$/.test(x.name)));
}

function parseLog(text, withBody = false) {
  const out = [];
  for (const rec of String(text || '').split('\0')) {
    const s = rec.replace(/^\n+/, '');
    if (!s) continue;
    const f = s.split('\x1f');
    if (f.length < 9 || !/^[0-9a-f]{7,64}$/.test(f[0])) continue;
    const c = {
      hash: f[0],
      short: f[0].slice(0, 7),
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      email: f[3],
      time: +f[4],
      committer: f[5],
      commitTime: +f[6],
      refs: parseRefs(f[7]),
      subject: f[8],
    };
    if (withBody) {
      const body = f.slice(9).join('\x1f');
      c.message = body.replace(/\s+$/, '');
      const rest = c.message.split('\n').slice(1).join('\n').replace(/^\n+/, '');
      c.coAuthors = [];
      c.body = rest.split('\n').filter((l) => {
        const m = /^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i.exec(l);
        if (m) c.coAuthors.push({ name: m[1], email: m[2] });
        return !m;
      }).join('\n').replace(/\s+$/, '');
    }
    out.push(c);
  }
  return out;
}

module.exports = { LOG_FORMAT, parseLog, parseRefs };
