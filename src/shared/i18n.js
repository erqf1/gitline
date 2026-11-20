'use strict';

// Texte auf Englisch und Deutsch. Spalten: en de
const LANGS = [['en', 'English'], ['de', 'Deutsch']];
const CODES = LANGS.map(([c]) => c);
const S = require('./strings');

function t(lang, key, vars) {
  const row = S[key];
  if (!row) return key;
  const i = Math.max(0, CODES.indexOf(lang));
  let text = row[i] || row[0];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

module.exports = { t, LANGS, KEYS: Object.keys(S) };
