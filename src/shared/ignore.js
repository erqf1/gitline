'use strict';

// Vorlagen für den .gitignore-Helfer (kurz und gebräuchlich)
const TEMPLATES = {
  Node: ['node_modules/', 'npm-debug.log*', 'yarn-error.log*', '.pnpm-debug.log*', 'dist/', 'build/', '.env', '.env.*', '!.env.example', 'coverage/'],
  Python: ['__pycache__/', '*.py[cod]', '.venv/', 'venv/', 'env/', '*.egg-info/', '.pytest_cache/', '.mypy_cache/', 'dist/', 'build/', '.env'],
  Java: ['*.class', '*.jar', 'target/', 'build/', '.gradle/', 'out/'],
  'C / C++': ['*.o', '*.obj', '*.so', '*.dll', '*.exe', '*.a', '*.lib', 'build/', 'cmake-build-*/'],
  '.NET': ['bin/', 'obj/', '*.user', '*.suo', '.vs/', 'packages/'],
  Rust: ['target/', '**/*.rs.bk'],
  Go: ['*.exe', '*.test', '*.out', 'vendor/'],
  Unity: ['[Ll]ibrary/', '[Tt]emp/', '[Oo]bj/', '[Bb]uild/', '[Bb]uilds/', '[Ll]ogs/', 'UserSettings/', '*.csproj', '*.sln'],
  macOS: ['.DS_Store', '.AppleDouble', '._*'],
  Windows: ['Thumbs.db', 'ehthumbs.db', 'Desktop.ini', '$RECYCLE.BIN/'],
  Linux: ['*~', '.directory', '.Trash-*'],
  'VS Code': ['.vscode/*', '!.vscode/settings.json', '!.vscode/extensions.json'],
  JetBrains: ['.idea/', '*.iml'],
  Logs: ['*.log', 'logs/'],
};

/** Zeilen anhängen, die noch fehlen; liefert den neuen Text */
function addLines(text, lines, title) {
  const have = new Set(String(text || '').split(/\r?\n/).map((l) => l.trim()));
  const fresh = lines.filter((l) => l.trim() && !have.has(l.trim()));
  if (!fresh.length) return String(text || '');
  let out = String(text || '');
  if (out && !out.endsWith('\n')) out += '\n';
  if (out) out += '\n';
  if (title) out += `# ${title}\n`;
  return `${out}${fresh.join('\n')}\n`;
}

/** Pfad als .gitignore-Muster (vom Repository-Wurzelordner aus) */
function patternFor(p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (s.startsWith('*')) return s;
  return `/${s.replace(/^\/+/, '').replace(/([*?[\]!#])/g, '\\$1')}`;
}

module.exports = { TEMPLATES, addLines, patternFor };
