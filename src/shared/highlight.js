'use strict';

// Kleine Syntaxfarben für die Diff-Ansicht. Zeilenweise, mit einem Zustand für mehrzeilige Kommentare und Strings.
// Absichtlich schlicht: Schlüsselwörter, Strings, Kommentare, Zahlen, Tags und Attribute.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KW = {
  js: 'await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async true false null undefined as interface type enum implements private protected public readonly declare namespace abstract keyof satisfies',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self match case',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr class namespace template typename public private protected virtual override new delete this using try catch throw final import package extends implements interface abstract boolean byte var val fun when object is in as string String func go defer chan map range select struct type fn let mut impl trait pub use mod match loop where crate self Self dyn async await move ref unsafe static readonly sealed internal foreach out params lock event delegate operator elif',
  sh: 'if then else elif fi for while until do done case esac function in return local export readonly declare unset shift exit echo source alias cd set true false',
  sql: 'select from where insert into values update set delete create table drop alter add column primary key foreign references index join left right inner outer on group by order having limit offset as and or not null is in like between distinct union all case when then else end default unique view',
  rb: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require attr_accessor',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
  css: '',
};
const SETS = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(' ').filter(Boolean))]));

const EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', vue: 'html', svelte: 'html', json: 'json', jsonc: 'json', json5: 'json',
  py: 'py', pyw: 'py', pyi: 'py',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c', cs: 'c', java: 'c', kt: 'c', kts: 'c', go: 'c', rs: 'c', swift: 'c', dart: 'c', scala: 'c', php: 'c', m: 'c', zig: 'c', gradle: 'c', groovy: 'c',
  sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', ps1: 'sh', bat: 'sh', cmd: 'sh', env: 'sh', dockerfile: 'sh', makefile: 'sh', mk: 'sh',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', xaml: 'html', plist: 'html', csproj: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', cfg: 'yaml', conf: 'yaml', properties: 'yaml', editorconfig: 'yaml', gitignore: 'sh', gitattributes: 'sh',
  md: 'md', markdown: 'md', rst: 'md',
  sql: 'sql', rb: 'rb', lua: 'lua',
};

function langOf(file) {
  const base = String(file || '').split(/[\\/]/).pop().toLowerCase();
  if (base === 'dockerfile' || base === 'makefile') return 'sh';
  if (base.startsWith('.') && !base.slice(1).includes('.')) return EXT[base.slice(1)] || null;
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT[ext] || null;
}

const span = (cls, text) => `<span class="hl-${cls}">${esc(text)}</span>`;

// Gemeinsamer Scanner für C-artige Sprachen (JS, C, Java, Go, Rust, CSS, JSON, SQL ...)
function scanCode(line, lang, state) {
  let out = '';
  let i = 0;
  const kw = SETS[lang === 'json' ? 'js' : lang] || SETS.c;
  const lineCom = { py: '#', sh: '#', yaml: '#', rb: '#', sql: '--', lua: '--', css: null }[lang] ?? '//';
  const block = lang === 'py' || lang === 'sh' || lang === 'yaml' || lang === 'rb' ? null : lang === 'lua' ? ['--[[', ']]'] : ['/*', '*/'];
  if (state && state.block) {
    const end = line.indexOf(state.block);
    if (end === -1) return { html: span('com', line), state };
    out += span('com', line.slice(0, end + state.block.length));
    i = end + state.block.length;
    state = null;
  }
  if (state && state.str) {
    const end = line.indexOf(state.str);
    if (end === -1) return { html: span('str', line), state };
    out += span('str', line.slice(0, end + state.str.length));
    i = end + state.str.length;
    state = null;
  }
  let plain = '';
  const flush = () => {
    if (plain) out += esc(plain);
    plain = '';
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i];
    if (lineCom && rest.startsWith(lineCom) && !(lang === 'sh' && i > 0 && /\S/.test(line[i - 1]) && line[i - 1] !== ' ')) {
      flush();
      out += span('com', rest);
      return { html: out, state: null };
    }
    if (block && rest.startsWith(block[0])) {
      flush();
      const end = line.indexOf(block[1], i + block[0].length);
      if (end === -1) {
        out += span('com', rest);
        return { html: out, state: { block: block[1] } };
      }
      out += span('com', line.slice(i, end + block[1].length));
      i = end + block[1].length;
      continue;
    }
    if (lang === 'py' && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      flush();
      const q = rest.slice(0, 3);
      const end = line.indexOf(q, i + 3);
      if (end === -1) {
        out += span('str', rest);
        return { html: out, state: { str: q } };
      }
      out += span('str', line.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    if (ch === '"' || ch === "'" || (ch === '`' && (lang === 'js' || lang === 'sh' || lang === 'c'))) {
      flush();
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      if (j >= line.length && ch === '`') {
        out += span('str', rest);
        return { html: out, state: { str: '`' } };
      }
      const s = line.slice(i, j + 1);
      // JSON-Schlüssel anders als Werte
      out += span(lang === 'json' && /^\s*:/.test(line.slice(j + 1)) ? 'prop' : 'str', s);
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[\w$]/.test(line[i - 1] || '')) {
      const m = /^(0x[0-9a-f_]+|0b[01_]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)[a-z]*/i.exec(rest);
      if (m) {
        flush();
        out += span('num', m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (lang === 'css' && (ch === '#' || ch === '.') && /[\w-]/.test(line[i + 1] || '') && !/:/.test(line.slice(0, i))) {
      const m = /^[#.][\w-]+/.exec(rest);
      flush();
      out += span('tag', m[0]);
      i += m[0].length;
      continue;
    }
    if (lang === 'sh' && ch === '$') {
      const m = /^\$(\{[^}]*\}|\w+|[@#?$!*-])/.exec(rest);
      if (m) {
        flush();
        out += span('prop', m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (lang === 'c' && ch === '#' && !line.slice(0, i).trim()) {
      flush();
      const m = /^#\s*\w+/.exec(rest);
      if (m) {
        out += span('kw', m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (ch === '@' && (lang === 'py' || lang === 'js' || lang === 'c' || lang === 'css')) {
      const m = /^@[\w.-]+/.exec(rest);
      if (m) {
        flush();
        out += span('kw', m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch) && !/[\w$]/.test(line[i - 1] || '')) {
      const m = /^[A-Za-z_$][\w$-]*/.exec(rest);
      let word = m[0];
      if (lang !== 'css' && lang !== 'sh') word = /^[A-Za-z_$][\w$]*/.exec(rest)[0];
      flush();
      const key = lang === 'sql' ? word.toLowerCase() : word;
      if (lang === 'css') {
        if (/^\s*:/.test(line.slice(i + word.length)) && !line.includes('{')) out += span('prop', word);
        else out += esc(word);
      } else if (lang === 'yaml' && /^\s*[:=]/.test(line.slice(i + word.length)) && !line.slice(0, i).trim().replace(/^-\s*/, '')) out += span('prop', word);
      else if (kw.has(key)) out += span('kw', word);
      else if (/^\s*\(/.test(line.slice(i + word.length))) out += span('fn', word);
      else if (/^[A-Z][a-z]/.test(word) && lang !== 'sql') out += span('type', word);
      else out += esc(word);
      i += word.length;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return { html: out, state: null };
}

function scanMarkup(line, state) {
  let out = '';
  let i = 0;
  if (state && state.block) {
    const end = line.indexOf('-->');
    if (end === -1) return { html: span('com', line), state };
    out += span('com', line.slice(0, end + 3));
    i = end + 3;
    state = null;
  }
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith('<!--')) {
      const end = line.indexOf('-->', i + 4);
      if (end === -1) return { html: out + span('com', rest), state: { block: '-->' } };
      out += span('com', line.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    const tag = /^<\/?[\w:.-]+/.exec(rest);
    if (tag) {
      out += span('tag', tag[0]);
      i += tag[0].length;
      // Attribute bis zum Ende des Tags
      while (i < line.length && line[i] !== '>') {
        const r = line.slice(i);
        const attr = /^(\s+)([\w:@.#-]+)/.exec(r);
        if (attr) {
          out += esc(attr[1]) + span('attr', attr[2]);
          i += attr[0].length;
          continue;
        }
        const str = /^=?\s*("[^"]*"?|'[^']*'?)/.exec(r);
        if (str) {
          out += esc(str[0].slice(0, str[0].length - str[1].length)) + span('str', str[1]);
          i += str[0].length;
          continue;
        }
        out += esc(line[i]);
        i++;
      }
      if (line[i] === '>') {
        out += span('tag', '>');
        i++;
      }
      continue;
    }
    if (rest.startsWith('/>')) {
      out += span('tag', '/>');
      i += 2;
      continue;
    }
    const m = /^[^<]+/.exec(rest);
    const text = m ? m[0] : line[i];
    out += esc(text);
    i += text.length;
  }
  return { html: out, state: null };
}

function scanMarkdown(line) {
  if (/^\s{0,3}#{1,6}\s/.test(line)) return { html: span('kw', line), state: null };
  if (/^\s{0,3}(```|~~~)/.test(line)) return { html: span('com', line), state: null };
  if (/^\s*>/.test(line)) return { html: span('com', line), state: null };
  let html = esc(line);
  html = html.replace(/(`[^`]+`)/g, '<span class="hl-str">$1</span>').replace(/(\*\*[^*]+\*\*)/g, '<span class="hl-type">$1</span>').replace(/(\[[^\]]+\]\([^)]+\))/g, '<span class="hl-fn">$1</span>');
  html = html.replace(/^(\s*)([-*+]|\d+\.)(\s)/, '$1<span class="hl-kw">$2</span>$3');
  return { html, state: null };
}

/** Eine Zeile einfärben. state kommt von der Zeile davor (gleiche Seite). */
function highlightLine(text, lang, state = null) {
  if (!lang || text.length > 2000) return { html: esc(text), state: null };
  if (lang === 'html') return scanMarkup(text, state);
  if (lang === 'md') return scanMarkdown(text);
  return scanCode(text, lang, state);
}

module.exports = { highlightLine, langOf, esc };
