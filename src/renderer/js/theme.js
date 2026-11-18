// Farben der Oberfläche (hell/dunkel) und die Akzentfarbe als CSS-Variablen.
// Diff- und Statusfarben ohne Orange: Grün steht hier ständig im Bild.
import { parseHex, luminance } from './color.js';
import { hueOf, smokeUrl } from './smoke.js';

const LIGHT = {
  bg: '#f3f4f7', panel: '#ffffff', panel2: '#f2f3f6', line: '#e2e5eb', text: '#1b1f27', muted: '#6b7280', hover: 'rgba(0,0,0,0.05)',
  canvasBg: '#f7f8fa', danger: '#dc2626', shadow: '0 12px 32px -12px rgba(20,24,40,0.28), 0 2px 6px rgba(20,24,40,0.08)',
  addBg: '#e7f6ec', delBg: '#fdebec', addGutter: '#cdeed8', delGutter: '#f9d3d6', addText: '#15803d', delText: '#b91c1c', hunkBg: '#eef1f6', selBg: 'rgba(37,99,235,0.16)',
  stM: '#2563eb', stA: '#16a34a', stD: '#dc2626', stR: '#7c3aed', stU: '#c026d3',
  hlKw: '#7c3aed', hlStr: '#15803d', hlNum: '#1d4ed8', hlCom: '#6b7280', hlFn: '#0369a1', hlType: '#a21caf', hlTag: '#be185d', hlAttr: '#1d4ed8', hlProp: '#0e7490',
};
const DARK = {
  bg: '#14161b', panel: '#1b1e25', panel2: '#232731', line: '#2d323d', text: '#e8eaf0', muted: '#9aa1b2', hover: 'rgba(255,255,255,0.06)',
  canvasBg: '#16181e', danger: '#f87171', shadow: '0 16px 40px -12px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.35)',
  addBg: 'rgba(34,197,94,0.11)', delBg: 'rgba(239,68,68,0.12)', addGutter: 'rgba(34,197,94,0.2)', delGutter: 'rgba(239,68,68,0.2)', addText: '#4ade80', delText: '#f87171', hunkBg: 'rgba(255,255,255,0.035)', selBg: 'rgba(96,165,250,0.22)',
  stM: '#60a5fa', stA: '#4ade80', stD: '#f87171', stR: '#a78bfa', stU: '#e879f9',
  hlKw: '#c4a7ff', hlStr: '#9fdcae', hlNum: '#8fb4ff', hlCom: '#7c8394', hlFn: '#7dd3fc', hlType: '#f0abfc', hlTag: '#f9a8d4', hlAttr: '#93c5fd', hlProp: '#67e8f9',
};
// Stil Acryl: Flächen durchscheinend über dem Rauch, Aufklappendes fast deckend (--popup)
const ACRYL_DARK = {
  bg: '#1f2023', panel: 'rgba(255,255,255,0.055)', panel2: 'rgba(255,255,255,0.08)', line: 'rgba(255,255,255,0.11)',
  text: '#f0f1f4', muted: '#adb0b9', hover: 'rgba(255,255,255,0.08)', canvasBg: 'rgba(0,0,0,0.22)', popup: 'rgba(40,41,46,0.94)',
};
const ACRYL_LIGHT = {
  bg: '#eaeaed', panel: 'rgba(255,255,255,0.46)', panel2: 'rgba(255,255,255,0.62)', line: 'rgba(0,0,0,0.10)',
  text: '#17181c', muted: '#5b5c66', hover: 'rgba(0,0,0,0.05)', canvasBg: 'rgba(255,255,255,0.4)', popup: 'rgba(248,248,250,0.95)',
};
// Gitline-Fuchsia zuerst; Orange fehlt absichtlich (Grün ist in jedem Diff zu sehen)
export const ACCENTS = ['#c026d3', '#8b5cf6', '#ec4899', '#ef4444', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1', '#64748b'];
// Farben der Spuren in der Branch-Grafik
export const LANES = ['#d946ef', '#3b82f6', '#14b8a6', '#a78bfa', '#f43f5e', '#0ea5e9', '#22c55e', '#eab308', '#ec4899', '#6366f1'];

const NAMES = {
  bg: '--bg', panel: '--panel', panel2: '--panel2', line: '--line', text: '--text', muted: '--muted', hover: '--hover', canvasBg: '--canvas-bg', popup: '--popup', danger: '--danger', shadow: '--shadow',
  accent: '--accent', accentText: '--accent-text', accentSoft: '--accent-soft',
  addBg: '--add-bg', delBg: '--del-bg', addGutter: '--add-gutter', delGutter: '--del-gutter', addText: '--add-text', delText: '--del-text', hunkBg: '--hunk-bg', selBg: '--sel-bg',
  stM: '--st-m', stA: '--st-a', stD: '--st-d', stR: '--st-r', stU: '--st-u',
  hlKw: '--hl-kw', hlStr: '--hl-str', hlNum: '--hl-num', hlCom: '--hl-com', hlFn: '--hl-fn', hlType: '--hl-type', hlTag: '--hl-tag', hlAttr: '--hl-attr', hlProp: '--hl-prop',
};

export function applyTheme(accent, dark, look = 'standard') {
  const acryl = look === 'acryl';
  const v = { ...(dark ? DARK : LIGHT), ...(acryl ? (dark ? ACRYL_DARK : ACRYL_LIGHT) : {}) };
  v.popup = v.popup || v.panel;
  const a = parseHex(accent) || parseHex(ACCENTS[0]);
  v.accent = accent;
  v.accentText = luminance(a) > 0.62 ? '#111827' : '#ffffff';
  v.accentSoft = `rgba(${a.r},${a.g},${a.b},${dark ? 0.22 : 0.13})`;
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.look = acryl ? 'acryl' : 'standard';
  root.style.setProperty('--smoke', acryl ? `url("${smokeUrl(hueOf(accent), dark)}")` : 'none');
  for (const [k, css] of Object.entries(NAMES)) root.style.setProperty(css, v[k]);
  root.style.colorScheme = dark ? 'dark' : 'light';
  return v;
}
