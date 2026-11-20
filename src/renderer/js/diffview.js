// Diff-Ansicht: untereinander oder nebeneinander, mit Syntaxfarben, Abschnitts- und Zeilenauswahl und Bildervergleich.
import { h } from './ui.js';
import { icon } from './icons.js';
import { S, t, humanSize, emptyState } from './common.js';
import { splitRows } from '../../shared/diff.js';
import { highlightLine, langOf, esc } from '../../shared/highlight.js';

const MAX_LINES = 5000;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;

/** Alle Zeilen einer Datei einfärben (alte und neue Seite getrennt, damit Kommentare über Zeilen hinweg stimmen) */
function colorize(file, lang) {
  let oldState = null, newState = null;
  for (const hk of file.hunks) {
    oldState = null;
    newState = null;
    for (const l of hk.lines) {
      if (l.type === 'noeol') continue;
      if (l.type === 'del') {
        const r = highlightLine(l.text, lang, oldState);
        l.html = r.html;
        oldState = r.state;
      } else if (l.type === 'add') {
        const r = highlightLine(l.text, lang, newState);
        l.html = r.html;
        newState = r.state;
      } else {
        const r = highlightLine(l.text, lang, newState);
        l.html = r.html;
        newState = r.state;
        oldState = r.state;
      }
    }
  }
}

const sign = (type) => (type === 'add' ? '+' : type === 'del' ? '−' : '');
const code = (l) => (l.html != null ? l.html : esc(l.text)) || ' ';

function unifiedRows(hk, hi) {
  let out = '';
  hk.lines.forEach((l, li) => {
    if (l.type === 'noeol') {
      out += `<tr class="noeol"><td class="ln"></td><td class="ln"></td><td class="sg"></td><td class="code">${esc(t('noNewline'))}</td></tr>`;
      return;
    }
    const sel = l.type !== 'ctx' ? ` data-h="${hi}" data-l="${li}"` : '';
    out += `<tr class="${l.type}"${sel}><td class="ln o"${sel}>${l.oldNo ?? ''}</td><td class="ln n"${sel}>${l.newNo ?? ''}</td><td class="sg">${sign(l.type)}</td><td class="code">${code(l)}</td></tr>`;
  });
  return out;
}

function splitRowsHtml(hk, hi) {
  let out = '';
  for (const r of splitRows(hk)) {
    if (r.ctx) {
      out += `<tr class="ctx"><td class="ln">${r.left.oldNo}</td><td class="code">${code(r.left)}</td><td class="ln">${r.right.newNo}</td><td class="code">${code(r.right)}</td></tr>`;
      continue;
    }
    const side = (l, cls) => {
      if (!l) return '<td class="ln empty"></td><td class="code empty"></td>';
      const sel = ` data-h="${hi}" data-l="${l.index}"`;
      const no = cls === 'del' ? l.oldNo : l.newNo;
      return `<td class="ln ${cls}"${sel}>${no}</td><td class="code ${cls}"${sel}>${code(l)}${l.noeol ? `<span class="eol" title="${esc(t('noNewline'))}">⊘</span>` : ''}</td>`;
    };
    out += `<tr class="chg">${side(r.left, 'del')}${side(r.right, 'add')}</tr>`;
  }
  return out;
}

/**
 * Baut die Ansicht für eine Datei.
 * opts: { file, path, mode, kind: 'unstaged'|'staged'|'readonly', onHunk(action, index), onLines(action, index, lines), image: Promise|null, note }
 */
export function diffView(opts) {
  const { file, kind = 'readonly' } = opts;
  const mode = opts.mode || S.settings.diffMode || 'split';
  const root = h('div', { class: `diff-view ${mode}` });
  if (opts.image) {
    root.append(imageDiff(opts.image));
    return root;
  }
  if (!file) {
    root.append(emptyState('file', t('noDiff'), opts.note || ''));
    return root;
  }
  if (file.binary) {
    root.append(emptyState('file', t('binaryFile'), t('binaryHint')));
    return root;
  }
  if (!file.hunks.length) {
    const msg = file.status === 'A' ? t('emptyFile') : file.oldMode && file.newMode ? t('modeChange', { a: file.oldMode, b: file.newMode }) : file.status === 'R' ? t('renamedOnly') : t('noTextChanges');
    root.append(emptyState('file', msg, ''));
    return root;
  }
  const total = file.hunks.reduce((n, hk) => n + hk.lines.length, 0);
  const showAll = opts.showAll || total <= MAX_LINES;
  colorize(file, langOf(opts.path || file.path));
  const selected = new Map(); // Abschnitt -> Set der Zeilen
  const canAct = kind === 'unstaged' || kind === 'staged';
  let shown = 0;
  file.hunks.forEach((hk, hi) => {
    if (!showAll && shown > MAX_LINES) return;
    shown += hk.lines.length;
    const head = h('div', { class: 'hunk-head' },
      h('span', { class: 'hunk-range', text: `@@ −${hk.oldStart},${hk.oldCount} +${hk.newStart},${hk.newCount} @@` }),
      hk.section ? h('span', { class: 'hunk-sect', text: hk.section }) : null,
      h('span', { class: 'spacer' }));
    const selBtn = h('button', { class: 'btn mini hidden' });
    if (canAct) {
      head.append(selBtn);
      if (kind === 'unstaged') {
        head.append(h('button', { class: 'btn mini ghost', title: t('discardHunkTip'), onclick: () => opts.onHunk('discard', hi) }, icon('undo', 14), t('discardHunk')));
        head.append(h('button', { class: 'btn mini', title: t('stageHunkTip'), onclick: () => opts.onHunk('stage', hi) }, icon('plus', 14), t('stageHunk')));
      } else {
        head.append(h('button', { class: 'btn mini', title: t('unstageHunkTip'), onclick: () => opts.onHunk('unstage', hi) }, icon('minus', 14), t('unstageHunk')));
      }
    }
    const table = h('table', { class: 'diff', html: `<colgroup>${mode === 'split' ? '<col class="c-ln"><col class="c-code"><col class="c-ln"><col class="c-code">' : '<col class="c-ln"><col class="c-ln"><col class="c-sg"><col class="c-code">'}</colgroup><tbody>${mode === 'split' ? splitRowsHtml(hk, hi) : unifiedRows(hk, hi)}</tbody>` });
    const hunk = h('div', { class: 'hunk' }, head, table);
    if (canAct) {
      let last = null;
      const update = () => {
        const set = selected.get(hi) || new Set();
        table.querySelectorAll('[data-l]').forEach((el) => el.classList.toggle('picked', set.has(+el.dataset.l)));
        selBtn.classList.toggle('hidden', !set.size);
        selBtn.replaceChildren(icon(kind === 'unstaged' ? 'plus' : 'minus', 14), t(kind === 'unstaged' ? 'stageLines' : 'unstageLines', { n: set.size }));
      };
      selBtn.onclick = () => opts.onLines(kind === 'unstaged' ? 'stage' : 'unstage', hi, [...(selected.get(hi) || [])]);
      table.title = t('pickLinesTip');
      table.addEventListener('mousedown', (e) => {
        const cell = e.target.closest('td.ln[data-l]');
        if (!cell) return;
        e.preventDefault();
        const li = +cell.dataset.l;
        const set = selected.get(hi) || new Set();
        if (e.shiftKey && last != null) {
          const [a, b] = [Math.min(last, li), Math.max(last, li)];
          hk.lines.forEach((l, i) => {
            if (i >= a && i <= b && (l.type === 'add' || l.type === 'del')) set.add(i);
          });
        } else if (set.has(li)) set.delete(li);
        else set.add(li);
        last = li;
        selected.set(hi, set);
        update();
      });
    }
    root.append(hunk);
  });
  if (!showAll) {
    root.append(h('div', { class: 'diff-more' }, h('span', { text: t('diffTooLong', { n: total.toLocaleString(S.settings.language) }) }),
      h('button', { class: 'btn', text: t('showAll'), onclick: () => root.replaceWith(diffView({ ...opts, showAll: true })) })));
  }
  return root;
}

/** Bilder vorher / nachher */
function imageDiff(promise) {
  const box = h('div', { class: 'image-diff' }, h('div', { class: 'loading', text: t('loading') }));
  promise.then(({ before, after }) => {
    const pane = (label, img, cls) => {
      const meta = h('div', { class: 'img-meta' });
      const el = h('div', { class: `img-pane ${cls}` }, h('div', { class: 'img-label', text: label }),
        h('div', { class: 'img-frame' }, img ? h('img', { src: img.url, alt: '', onload: (e) => {
          const im = e.target;
          meta.textContent = `${im.naturalWidth} × ${im.naturalHeight} · ${humanSize(img.size)}`;
          // Sehr kleine Bilder (Symbole) vergrößert und scharf zeigen
          if (im.naturalWidth && im.naturalWidth < 96 && im.naturalHeight < 96) {
            const f = Math.max(2, Math.floor(128 / Math.max(im.naturalWidth, im.naturalHeight)));
            im.style.width = `${im.naturalWidth * f}px`;
            im.style.imageRendering = 'pixelated';
          }
        } }) : h('div', { class: 'img-none', text: t('noImage') })),
        meta);
      return el;
    };
    box.replaceChildren(pane(t('before'), before, 'before'), pane(t('after'), after, 'after'));
  }).catch(() => box.replaceChildren(emptyState('image', t('noImage'), '')));
  return box;
}

/** Datei mit Konfliktmarkern: die Abschnitte farbig, Rest normal */
export function conflictView(text, path) {
  const lang = langOf(path);
  const lines = String(text || '').split('\n');
  let mode = null;
  let st = null;
  let html = '';
  let n = 0;
  for (const l of lines) {
    n++;
    let cls = mode || '';
    if (/^<{7}( |$)/.test(l)) {
      mode = 'ours';
      cls = 'marker ours';
    } else if (mode && /^\|{7}( |$)/.test(l)) {
      mode = 'base';
      cls = 'marker base';
    } else if (mode && /^={7}$/.test(l)) {
      mode = 'theirs';
      cls = 'marker theirs';
    } else if (mode && /^>{7}( |$)/.test(l)) {
      mode = null;
      cls = 'marker theirs';
    }
    let body;
    if (cls.startsWith('marker')) body = esc(l);
    else {
      const r = highlightLine(l, lang, st);
      st = r.state;
      body = r.html;
    }
    html += `<tr class="${cls}"><td class="ln">${n}</td><td class="code">${body || ' '}</td></tr>`;
  }
  return h('table', { class: 'diff conflict-text', html: `<colgroup><col class="c-ln"><col class="c-code"></colgroup><tbody>${html}</tbody>` });
}
