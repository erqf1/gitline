# Gitline

A simple, good-looking app for Git. See what changed, stage whole files, single sections or single lines, commit, branch, merge, pull and push without the terminal. Part of the W Software "Line" series (Vidline, Clipline, Webline, Textline, Picline, Convertline).

Website: [mert.win/git](https://mert.win/git/)

## Features

- **Repositories:** open a folder, recently opened list, clone by URL with progress, create a new repository with README and `.gitignore` template.
- **Changes:** unstaged and staged files, stage or unstage whole files, single sections (hunks) or single lines, discard changes (asks first, new files go to the trash).
- **Diff:** side by side or one below the other, syntax colors for many languages, images as before/after.
- **Commit:** summary and description, amend, co-authors.
- **History:** branch graph, commit details, file history across renames, search by message, author or hash; cherry-pick, revert, reset.
- **Branches:** create, switch (offers to stash changes in the way), rename, delete, merge. Conflicts are shown in color: keep mine, take theirs, or open the file in [Textline](https://mert.win/text/) if it is installed.
- **Pull, push and fetch** with progress. Sign-in goes through the Git Credential Manager of your system; **Gitline never stores passwords or tokens.**
- **Stash, tags** and a **`.gitignore` helper**.
- English and German, light and dark mode, accent color, optional Acrylic style. Right-click "Open with Gitline" on folders in Windows.

Gitline uses the `git` installed on your computer. If it is missing, Gitline says so and links to [git-scm.com](https://git-scm.com/downloads).

## Download

| System | File |
| --- | --- |
| Windows (installer) | `Gitline-Setup-<version>.exe` |
| Windows (portable) | `Gitline-<version>-portable.exe` |
| Linux | `.deb`, `.pacman` or `.tar.gz` |
| macOS | `Gitline-<version>-mac-arm64.zip` or `-mac-x64.zip` |

All files are on the [releases page](https://github.com/erqf1/gitline/releases/latest). The Windows installer updates itself.

## Building

Requires Node.js 22.2+ and Git.

```bash
npm ci
npm start
```

Tests run in a hidden window with temporary repositories (nothing outside the test folder is touched):

```bash
npx electron . --selftest ./test-output
```

Screenshots for the website:

```bash
npx electron . --siteshots ./site
```

## License

Apache License 2.0.
