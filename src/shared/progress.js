'use strict';

// Fortschritt von clone, fetch, pull und push aus der Ausgabe von git lesen.
// Die Phasen bekommen feste Anteile, damit der Balken nicht bei jeder Phase von vorn beginnt.
const PHASES = [
  ['Enumerating objects', 0, 0.04],
  ['Counting objects', 0.04, 0.08],
  ['Compressing objects', 0.08, 0.16],
  ['Receiving objects', 0.16, 0.8],
  ['Writing objects', 0.16, 0.9],
  ['Resolving deltas', 0.8, 0.95],
  ['Updating files', 0.95, 1],
  ['Checking out files', 0.95, 1],
];

function parseProgress(line) {
  const s = String(line || '').replace(/^remote:\s*/, '').trim();
  if (!s) return null;
  for (const [name, from, to] of PHASES) {
    if (!s.startsWith(name)) continue;
    const m = /(\d+)%\s*\((\d+)\/(\d+)\)/.exec(s);
    if (!m) return { phase: name, ratio: from, text: s };
    const pct = Math.min(100, +m[1]) / 100;
    return { phase: name, percent: +m[1], done: +m[2], total: +m[3], ratio: from + (to - from) * pct, text: s };
  }
  return null;
}

module.exports = { parseProgress, PHASES };
