'use strict';

// Branch-Grafik für den Verlauf: verteilt Commits (in Topo-Reihenfolge) auf Spuren.
// Jede Zeile bekommt: col (Spur des Punkts), color, up[] (obere Hälfte: von Spur a oben zu Spur b in der Mitte)
// und down[] (untere Hälfte: von Spur a in der Mitte zu Spur b unten).

function layout(commits) {
  const lanes = [];      // erwarteter Hash je Spur
  const colors = [];     // Farbe je Spur
  let nextColor = 0;
  let width = 0;
  const rows = [];
  const free = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };
  for (const c of commits) {
    const before = lanes.slice();
    const beforeColors = colors.slice();
    let col = lanes.indexOf(c.hash);
    const fresh = col === -1;
    if (fresh) {
      col = free();
      lanes[col] = c.hash;
      colors[col] = nextColor++;
    }
    const color = colors[col];
    const up = [];
    before.forEach((h, j) => {
      if (h == null) return;
      if (h === c.hash) up.push({ from: j, to: col, color: beforeColors[j] });
      else up.push({ from: j, to: j, color: beforeColors[j], pass: true });
    });
    // Alle Spuren, die auf diesen Commit gewartet haben, enden hier
    for (let j = 0; j < lanes.length; j++) if (lanes[j] === c.hash && j !== col) lanes[j] = null;
    const down = [];
    const [first, ...others] = c.parents;
    if (first) {
      const k = lanes.indexOf(first);
      if (k !== -1 && k !== col) {
        // Erster Elternteil liegt schon auf einer anderen Spur: dort hinüber
        down.push({ from: col, to: k, color: colors[k] });
        lanes[col] = null;
      } else {
        lanes[col] = first;
        down.push({ from: col, to: col, color });
      }
    } else lanes[col] = null;
    for (const p of others) {
      let k = lanes.indexOf(p);
      if (k === -1) {
        k = free();
        lanes[k] = p;
        colors[k] = nextColor++;
      }
      down.push({ from: col, to: k, color: colors[k], merge: true });
    }
    lanes.forEach((h, j) => {
      if (h != null && before[j] === h && h !== c.hash && j !== col) down.push({ from: j, to: j, color: colors[j], pass: true });
    });
    while (lanes.length && lanes[lanes.length - 1] == null) {
      lanes.pop();
      colors.length = lanes.length;
    }
    const used = Math.max(col + 1, before.length, ...down.map((d) => Math.max(d.from, d.to) + 1));
    width = Math.max(width, used);
    rows.push({ hash: c.hash, col, color, up, down, merge: c.parents.length > 1, start: fresh });
  }
  return { rows, width };
}

module.exports = { layout };
