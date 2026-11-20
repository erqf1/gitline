ERGEBNIS CLOUD-SESSION gitline

1. Aufgabe und Status
Gitline 1.0.0 als neues Programm der Line-Serie bauen (Electron-Git-Oberfläche, Website, Release).
Status: teilweise – Programm, Tests, CI und Website fertig; Release v1.0.0 NICHT gestartet, weil die Cloud keine Tags pushen darf (und nicht auf main).

2. Branch, Commits, PR, Release, CI
- Branch: claude/awesome-babbage-xno7q0 (Repo erqf1/gitline)
- Commits: 6ede0ac, 22c9118, 2f6abd0, fc72492, 507d794, 1f3b36d (Code-Stand für das Release), danach nur noch diese Ergebnis-Datei
- PR nach main: PR_LINK
- Release-Tag v1.0.0: nicht gepusht. "git push origin v1.0.0" bricht jedes Mal ab ("send-pack: unexpected disconnect", 3 Versuche) – die Cloud darf nur den eigenen Branch pushen.
- CI "Selbsttest" (.github/workflows/test.yml) auf Windows, Linux und macOS: alle 3 Jobs grün (Run 44735795032 auf fc72492). Spätere Commits ändern nur Website, README und Release-Notizen.
- Lokal zusätzlich gebaut: Linux tar.gz mit electron-builder (afterPack-Prüfung ok); das gepackte Programm startet ohne Absturz.

3. Was gebaut wurde
- Aufbau wie Convertline/Picline/Textline: Electron 43.8.7, esbuild (build.mjs), electron-builder, electron-updater, gleiche Update-Logik (Installer automatisch, Portable/macOS/tar.gz mit Hinweis), --selftest und --siteshots, Stile Standard/Acryl, Akzentfarbe, Hell/Dunkel, i18n Englisch + Deutsch.
- Akzentfarbe: Fuchsia #c026d3 (keine andere Line-App hat sie). Kein Orange in der App: Akzentliste ohne Orange, Diff-, Status-, Grafik- und Syntaxfarben ohne Orange.
- Logo: Verzweigung (3 Ringe, Abzweig) auf Fuchsia-Verlauf; assets/icon.png, icon.ico, icon.icns aus tools/make-icon.js (npm run icon).
- src/git.js: alles über das installierte git (sucht auch in Homebrew/Programme-Ordnern), Fehler werden in Arten übersetzt (Anmeldung, Netz, abgelehnt, Konflikt …). GIT_TERMINAL_PROMPT=0, keine Editor/Pager-Fenster. Gitline speichert keine Passwörter/Tokens; Anmeldung über den Git Credential Manager des Systems.
- src/shared/: status.js (porcelain v2), log.js, diff.js (Diff-Parser, Patch für Abschnitte und einzelne Zeilen), graph.js (Branch-Grafik), highlight.js (Syntaxfarben), progress.js, ignore.js (.gitignore-Vorlagen), strings.js/i18n.js.
- Oberfläche src/renderer/js/: app.js (Startseite, Kopfleiste mit Repo/Branch/Abrufen/Pull/Push, Banner für Merge/Rebase/losgelösten HEAD), changes.js (nicht vorgemerkt/vorgemerkt/Konflikte, Commit mit Amend und Co-Autoren, Strg+Enter), diffview.js (nebeneinander/untereinander, Syntaxfarben, Abschnitt/Zeilen vormerken, zurücknehmen, verwerfen, Bilder vorher/nachher, Konfliktansicht), history.js (Grafik, Details, Suche, Datei-Verlauf, Cherry-Pick, Revert, Reset), branches.js (anlegen, wechseln mit Stash-Angebot, umbenennen, löschen, zusammenführen, Vergleich), stash.js, tags.js, sync.js (Fortschritt, Abbrechen), dialogs.js (Klonen, neues Repo, .gitignore, Identität, Co-Autoren, Remote, Einstellungen).
- Konflikte: „Meine behalten“ / „Deren nehmen“ / „In Textline öffnen“ (falls installiert, sonst Standard-Editor) / „Als gelöst markieren“, dann abschließen oder abbrechen.
- Fehlt git: freundlicher Hinweis je System mit Link https://git-scm.com/downloads und „Erneut prüfen“.
- Windows: „Mit Gitline öffnen“ im Kontextmenü von Ordnern (build/installer.nsh).
- .github/workflows/release.yml (bei Tag v*: Entwurf, Selbsttest + Build auf Windows/Linux/macOS, Veröffentlichen; Notizen kurz auf Deutsch mit Link https://mert.win/git/changelog.html) und test.yml (Selbsttest bei jedem Push).
- Website: website/git/index.html und website/git/changelog.html aus website-vorlage (Aufbau unverändert, data-acryl="plum", --a1/--a2/--a3 Fuchsia; zusätzlich die vom Akzent abhängigen Werte --label/--orb* und im Changelog die orangen Badge/Fokus-Farben auf Fuchsia gesetzt, damit kein Himmelblau/Orange übrig bleibt). Links /app-icons/acryl.css und /app-icons/mobile.css bleiben. 16 echte Screenshots per --siteshots als WebP in website/git/img/ (changes, history, branches, stash, conflict, start, acryl, light – je en/de), dazu website/git/icon.png.

4. Getestet
- Selbsttest (unsichtbar, temporäre Repos, globale Git-Konfiguration bleibt unberührt): 165 Prüfungen, 0 Fehler – lokal unter Linux/Xvfb und in der CI auf Windows, Linux, macOS grün.
  Enthält: Parser (Status, Log, Fortschritt, Diff inkl. Leerzeichen/Umlaute/kein Zeilenende, Patches), Grafik, Syntaxfarben, Texte vollständig, init, Commit/Amend/Co-Autor, Abschnitte und einzelne Zeilen vormerken/zurücknehmen/verwerfen, Branch anlegen/umbenennen/löschen, Merge vorspulen, Merge mit Konflikt (deren/meine/von Hand/abbrechen), Stash mit neuen Dateien, Tags, Datei-Verlauf über Umbenennung, Suche, Cherry-Pick, Revert, Reset, Push/Klonen/Abrufen/Pull (Merge und Rebase) über ein lokales Server-Repo inkl. Fortschritt, abgelehnter Push, Branch auf Server löschen, Oberfläche (Diff, Abschnitt per Knopf, Zeilenauswahl, Bildvergleich, Commit, Verlauf, Branches, Stash, Tag, Konflikt lösen und Merge abschließen, Einstellungen, Sprachen, Acryl, Hell), keine Konsolenfehler.
- NICHT getestet: echte Anmeldung bei GitHub/GitLab über den Credential Manager und SSH (in der Cloud nicht möglich); Installer/Auto-Update und die fertigen Pakete für Windows/macOS (.exe/.zip, .deb/.pacman) – das passiert erst im Release-Workflow; „In Textline öffnen“ mit installiertem Textline; Kontextmenü-Eintrag unter Windows.

5. Offene Punkte, Risiken, was der Nutzer tun muss
- Release fehlt: PR mergen, dann Tag v1.0.0 auf main pushen (oder Release in GitHub mit Tag v1.0.0 anlegen). Danach prüfen, dass alle Pakete im Release liegen: Gitline-Setup-1.0.0.exe, Gitline-1.0.0-portable.exe, Gitline-1.0.0-amd64.deb, Gitline-1.0.0-x86_64.pacman, Gitline-1.0.0-x64.tar.gz, Gitline-1.0.0-mac-arm64.zip, Gitline-1.0.0-mac-x64.zip (+ latest*.yml).
- Changelog-Datum steht auf 20. November 2026 – bei späterem Release anpassen.
- macOS-App ist nur ad hoc signiert (wie die anderen Line-Apps): erster Start per Rechtsklick → Öffnen.
- Der Ordner website-vorlage/ liegt weiter im Repo (unverändert).

6. Nächste Schritte für die Haupt-Session
- PR mergen, Tag v1.0.0 pushen, Release-Workflow beobachten, Pakete prüfen.
- website/git/ (index.html, changelog.html, icon.png, img/) nach Websites/git kopieren; prüfen, dass /app-icons/acryl/plum.webp existiert; eventuell /app-icons/git-192.png anlegen.
- W-Hub-Katalog um Gitline ergänzen (Repo erqf1/gitline, Akzent #c026d3, Icon assets/icon.png) und /help-Karte ergänzen.
- Optional: Gitline auf der Übersichtsseite von mert.win verlinken.
