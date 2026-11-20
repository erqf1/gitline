'use strict';

// Bilder für die Website (unsichtbar): npx electron . --siteshots <ordner>
// Alles echt: ein selbst erzeugtes Demo-Projekt mit erfundenen Personen, echte git-Befehle.
// Ergebnis: <ordner>/<name>-<sprache>.webp (für website/git/img/)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const git = require('../src/git');

const PEOPLE = [['Lena Vogel', 'lena@example.com'], ['Jonas Berg', 'jonas@example.com'], ['Mira Kaya', 'mira@example.com'], ['Tom Reed', 'tom@example.com']];

const TXT = {
  en: {
    c1: 'Start weather app', c2: 'Show the forecast for five days', c3: 'Add icons for sun and rain', c4: 'Dark mode for the whole page', c5: 'Fix wind speed rounding',
    c6: 'Merge branch \'feature/dark-mode\'', c7: 'Search for a city', c8: 'Remember the last city', c9: 'Celsius and Fahrenheit', c10: 'Update README', c11: 'Smaller bundle',
    stash: 'Half-done hourly chart', title: 'Weather', readme: 'A small weather app.',
  },
  de: {
    c1: 'Wetter-App angelegt', c2: 'Vorhersage für fünf Tage zeigen', c3: 'Symbole für Sonne und Regen', c4: 'Dunkler Modus für die ganze Seite', c5: 'Rundung der Windgeschwindigkeit korrigiert',
    c6: 'Merge branch \'feature/dark-mode\'', c7: 'Suche nach einer Stadt', c8: 'Letzte Stadt merken', c9: 'Celsius und Fahrenheit', c10: 'README aktualisiert', c11: 'Kleineres Paket',
    stash: 'Halbfertiges Stunden-Diagramm', title: 'Wetter', readme: 'Eine kleine Wetter-App.',
  },
};

const APP_V1 = `import { fetchForecast } from './api.js';

const DAYS = 5;

export async function showForecast(city) {
  const data = await fetchForecast(city, DAYS);
  const list = document.querySelector('#days');
  list.replaceChildren();
  for (const day of data.days) {
    const item = document.createElement('li');
    item.textContent = \`\${day.name}: \${Math.round(day.temp)}°\`;
    list.append(item);
  }
}

function windText(speed) {
  return \`\${speed.toFixed(1)} km/h\`;
}

export function init() {
  showForecast('Berlin');
}
`;

module.exports = function siteshots(win, dir) {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const OUT = dir;
  const SRC = path.join(dir, 'demo');
  const until = async (code, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(code)) return true;
      await wait(80);
    }
    console.log('Zeit abgelaufen:', code);
    return false;
  };
  // Bild als WebP speichern (Umwandlung im Fenster über ein Canvas)
  const shot = async (name) => {
    await js('document.querySelectorAll(".toast").forEach((t) => t.remove())');
    await wait(500);
    wc.invalidate();
    await wait(400);
    await wc.capturePage();
    const png = (await wc.capturePage()).toPNG();
    const b64 = await js(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${png.toString('base64')}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.88).split(',')[1];
    })()`);
    fs.writeFileSync(path.join(OUT, `${name}.webp`), Buffer.from(b64, 'base64'));
    console.log('Bild', name);
  };

  let clock = Math.floor(Date.now() / 1000) - 12 * 86400;
  const env = (who, step = 5 * 3600) => {
    clock += step;
    const [name, email] = PEOPLE[who];
    const date = `${clock} +0100`;
    return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  };
  const G = (cwd, args, e) => git.run(args, { cwd, env: e });
  const write = (repo, file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  const commit = async (repo, who, msg, step) => {
    await G(repo, ['add', '-A']);
    await G(repo, ['commit', '-q', '-m', msg], env(who, step));
  };

  async function buildDemo(lang) {
    const T = TXT[lang];
    clock = Math.floor(Date.now() / 1000) - 12 * 86400;
    const root = path.join(SRC, lang);
    fs.rmSync(root, { recursive: true, force: true });
    const repo = path.join(root, lang === 'de' ? 'wetter-app' : 'weather-app');
    const server = path.join(root, 'server.git');
    await git.run(['init', '--bare', '-b', 'main', server], { cwd: SRC });
    await git.init(repo, 'main');
    for (const [k, v] of [['user.name', 'Lena Vogel'], ['user.email', 'lena@example.com'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.autocrlf', 'false']]) await G(repo, ['config', k, v]);
    write(repo, 'README.md', `# ${T.title}\n\n${T.readme}\n`);
    write(repo, 'index.html', `<!doctype html>\n<html lang="${lang}">\n<head>\n  <meta charset="utf-8">\n  <title>${T.title}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>${T.title}</h1>\n  <ul id="days"></ul>\n  <script type="module" src="app.js"></script>\n</body>\n</html>\n`);
    write(repo, 'style.css', 'body {\n  font-family: system-ui, sans-serif;\n  margin: 0 auto;\n  max-width: 720px;\n}\n\nh1 {\n  font-size: 2rem;\n}\n');
    write(repo, '.gitignore', 'node_modules/\ndist/\n');
    await commit(repo, 0, T.c1);
    write(repo, 'app.js', APP_V1);
    write(repo, 'api.js', 'export async function fetchForecast(city, days) {\n  const res = await fetch(`/api/forecast?city=${encodeURIComponent(city)}&days=${days}`);\n  return res.json();\n}\n');
    await commit(repo, 0, T.c2);
    write(repo, 'icons/sun.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="12" fill="#facc15"/></svg>\n');
    write(repo, 'icons/rain.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M20 40h26a10 10 0 0 0 0-20 14 14 0 0 0-26 4 8 8 0 0 0 0 16z" fill="#93c5fd"/></svg>\n');
    await commit(repo, 2, T.c3);
    await G(repo, ['tag', '-a', 'v1.0.0', '-m', 'Version 1.0.0'], env(0, 600));
    await G(repo, ['switch', '-q', '-c', 'feature/dark-mode']);
    write(repo, 'style.css', 'body {\n  font-family: system-ui, sans-serif;\n  margin: 0 auto;\n  max-width: 720px;\n}\n\nh1 {\n  font-size: 2rem;\n}\n\n@media (prefers-color-scheme: dark) {\n  body {\n    background: #111827;\n    color: #e5e7eb;\n  }\n}\n');
    await commit(repo, 1, T.c4);
    await G(repo, ['switch', '-q', 'main']);
    write(repo, 'app.js', APP_V1.replace('speed.toFixed(1)', 'Math.round(speed)'));
    await commit(repo, 3, T.c5);
    await G(repo, ['merge', '-q', '--no-ff', '-m', T.c6, 'feature/dark-mode'], env(0));
    await G(repo, ['switch', '-q', '-c', 'feature/city-search']);
    write(repo, 'search.js', 'export function citySearch(input, onPick) {\n  input.addEventListener(\'change\', () => onPick(input.value.trim()));\n}\n');
    await commit(repo, 2, T.c7);
    write(repo, 'search.js', 'const KEY = \'last-city\';\n\nexport function citySearch(input, onPick) {\n  input.value = localStorage.getItem(KEY) || \'\';\n  input.addEventListener(\'change\', () => {\n    localStorage.setItem(KEY, input.value.trim());\n    onPick(input.value.trim());\n  });\n}\n');
    await commit(repo, 2, T.c8);
    await G(repo, ['switch', '-q', 'main']);
    await G(repo, ['switch', '-q', '-c', 'fix/units']);
    write(repo, 'units.js', 'export const toFahrenheit = (c) => c * 9 / 5 + 32;\n');
    await commit(repo, 3, T.c9);
    await G(repo, ['switch', '-q', 'main']);
    write(repo, 'README.md', `# ${T.title}\n\n${T.readme}\n\n## Start\n\n\`npm start\`\n`);
    await commit(repo, 1, T.c10);
    await G(repo, ['tag', '-a', 'v1.1.0', '-m', 'Version 1.1.0'], env(0, 600));
    await G(repo, ['remote', 'add', 'origin', server]);
    await G(repo, ['push', '-q', '-u', 'origin', 'main', 'feature/city-search', '--tags']);
    write(repo, 'api.js', 'export async function fetchForecast(city, days) {\n  const res = await fetch(`/api/forecast?city=${encodeURIComponent(city)}&days=${days}`, { cache: \'no-store\' });\n  return res.json();\n}\n');
    await commit(repo, 0, T.c11, 3 * 3600);
    // Stash
    write(repo, 'chart.js', 'export function hourly(canvas, hours) {\n  // TODO\n}\n');
    await G(repo, ['stash', 'push', '-q', '--include-untracked', '-m', T.stash]);
    // Aktuelle Änderungen: app.js an zwei Stellen, neues Symbol, style.css vorgemerkt
    const v2 = APP_V1.replace('speed.toFixed(1)', 'Math.round(speed)')
      .replace("import { fetchForecast } from './api.js';", "import { fetchForecast } from './api.js';\nimport { citySearch } from './search.js';")
      .replace('const DAYS = 5;', 'const DAYS = 7;')
      .replace("    item.textContent = `${day.name}: ${Math.round(day.temp)}°`;", "    item.className = day.rain > 0.5 ? 'rain' : 'sun';\n    item.textContent = `${day.name}: ${Math.round(day.temp)}° · ${windText(day.wind)}`;")
      .replace("  showForecast('Berlin');", "  citySearch(document.querySelector('#city'), showForecast);\n  showForecast(localStorage.getItem('last-city') || 'Berlin');");
    write(repo, 'app.js', v2);
    write(repo, 'icons/snow.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#e0f2fe" stroke-width="4" stroke-linecap="round"><path d="M32 12v40M14 22l36 20M50 22 14 42"/></g></svg>\n');
    write(repo, 'style.css', fs.readFileSync(path.join(repo, 'style.css'), 'utf8') + '\nli.rain {\n  color: #2563eb;\n}\n');
    await G(repo, ['add', 'style.css']);
    return repo;
  }

  async function conflictRepo(repo, lang) {
    // fix/units ändert README auch, dann gibt es beim Zusammenführen einen Konflikt
    await G(repo, ['stash', 'push', '-q', '--include-untracked', '-m', 'tmp']);
    await G(repo, ['switch', '-q', 'fix/units']);
    write(repo, 'README.md', `# ${TXT[lang].title}\n\n${TXT[lang].readme}\n\n## Start\n\n\`npm run dev\`\n`);
    await commit(repo, 3, TXT[lang].c9);
    await G(repo, ['switch', '-q', 'main']);
    try {
      await G(repo, ['merge', '--no-edit', 'fix/units']);
    } catch {
      // Konflikt gewollt
    }
  }

  wc.once('did-finish-load', async () => {
    try {
      fs.mkdirSync(SRC, { recursive: true });
      win.setContentSize(1280, 800);
      await until('!!window.__gl');
      for (const lang of ['en', 'de']) {
        const repo = await buildDemo(lang);
        await js(`window.__gl.set({ language: "${lang}", mode: "dark", look: "standard", accent: "#c026d3", diffMode: "split", allBranches: true, sideWidth: 340, recent: [] }); window.__gl.emit("language")`);
        await js(`window.__gl.openRepo(${JSON.stringify(repo)})`);
        await until('window.__gl.S.status && window.__gl.idle()');
        await until('!!document.querySelector("#main table.diff")');
        await shot(`changes-${lang}`);
        await js('window.__gl.setTab("history")');
        await until('document.querySelectorAll(".commit-list .row.commit").length > 8 && !!document.querySelector("#main .cfiles .row")');
        // Merge-Commit mit Grafik auswählen
        await js('[...document.querySelectorAll(".commit-list .row.commit")].find((r) => r.querySelector(".subj").textContent.startsWith("Merge")).click()');
        await until('!!document.querySelector("#main .cc-subject") && document.querySelector("#main .cc-subject").textContent.startsWith("Merge") && !!document.querySelector("#main table.diff")');
        await shot(`history-${lang}`);
        await js('window.__gl.setTab("branches")');
        await js('[...document.querySelectorAll("#side .row.branch")].find((r) => r.dataset.name === "feature/city-search").click()');
        await until('!!document.querySelector("#main .cblock .row") || !!document.querySelector("#main .cblock p")');
        await shot(`branches-${lang}`);
        await js('window.__gl.setTab("stash")');
        await until('!!document.querySelector("#main .cfiles .row") && !!document.querySelector("#main table.diff")');
        await shot(`stash-${lang}`);
        await js('window.__gl.set({ look: "acryl" }); window.__gl.setTab("changes")');
        await until('!!document.querySelector("#main table.diff")');
        await shot(`acryl-${lang}`);
        await js('window.__gl.set({ look: "standard", mode: "light" })');
        await js('window.__gl.setTab("history")');
        await until('!!document.querySelector("#main table.diff")');
        await shot(`light-${lang}`);
        await js('window.__gl.set({ mode: "dark" })');
        await conflictRepo(repo, lang);
        await js('window.__gl.refresh(); window.__gl.setTab("changes")');
        await until('window.__gl.S.status.conflicted.length === 1 && !!document.querySelector("#main .conflict-bar")');
        await shot(`conflict-${lang}`);
        await js('window.__gl.closeRepo()');
        await until('!!document.querySelector(".welcome")');
        await shot(`start-${lang}`);
      }
      console.log('Bilder fertig');
    } catch (e) {
      console.log('Fehler:', e && e.stack ? e.stack : e);
    }
    app.exit(0);
  });
};
