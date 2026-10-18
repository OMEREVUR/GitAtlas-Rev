# Contributing to GitAtlas-Rev

*Türkçe özet aşağıda.*

Thanks for taking the time to help. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **License.** GitAtlas-Rev is source-available, not open source: MIT with the Commons Clause condition (see `LICENSE`). By contributing you agree that your contribution is released under the same terms. You may not sell the extension, or a product or service whose value derives substantially from it.
- **Bugs and ideas** go to [GitHub Issues](https://github.com/OMEREVUR/GitAtlas-Rev/issues); please use the templates. For a bug, the VS Code version, the GitAtlas-Rev version, your OS and the "GitAtlas-Rev Git" output channel are the most useful details.
- For a larger change, open an issue first so we can agree on the scope.

## Setup

```
npm install
npm run build          # dist/extension.js + dist/webview.js
npm run typecheck
npm test               # vitest; needs git on PATH
```

Press **F5** in VS Code to open the Extension Development Host. Only one copy of the extension may be active at a time: disable an installed Marketplace version while you debug, or commands will fail with "already registered".

Useful extras:

- `npm run fixture` creates a small deterministic test repository and prints its path.
- `npm run preview -- <repo> --lang en` renders the webview with real data from `<repo>` and saves headless Chrome screenshots to `dev/screenshots/`.
- `bash scripts/make-demo.sh` creates the larger demo repository used for the Marketplace screenshots.

## Rules of the codebase

- TypeScript `strict`, no `any` (use `unknown` and narrow it). Ask before adding a dependency.
- Git is called directly through `child_process` (no git library). The webview is plain TypeScript and DOM, no framework.
- Webview colors come only from `--vscode-*` variables and the `--rr-*` tokens derived from them in `src/webview/base.css`; no hard-coded colors. Check light, dark and high-contrast themes.
- No user-visible text in code: every string lives in the area's dictionary under `src/i18n/` with both an English and a Turkish version.
- Everything clickable is a real `<button>` or `<a>`; color never carries information on its own.
- Tests must not depend on the machine: they run with an isolated git configuration (`test/setup/isolateGit.ts`), so name the branch explicitly (`git init -b main`) instead of relying on `init.defaultBranch`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `test:`, `docs:`.

## Pull requests

- Keep a pull request to one topic.
- `npm run typecheck` and `npm test` must pass (CI runs them on Ubuntu and Windows).
- For UI changes, attach before/after screenshots (`npm run preview`), ideally in both light and dark themes.
- If you add a setting, update `package.json`, `package.nls.json`, `package.nls.tr.json`, `README.md` and `README.tr.md` together.

## A known quirk: setting keys

The extension was renamed twice before its first public release. The package is now `gitatlas-rev`, but command, view and setting IDs still start with `gitatlas-revrev.` (for example `gitatlas-revrev.language`). This is deliberate: renaming them would silently reset every user's settings and keybindings. New IDs keep the `gitatlas-revrev.` prefix too, so that all of them stay consistent.

---

## Türkçe özet

- Lisans MIT + Commons Clause: kaynak açık ama açık kaynak değil; katkın aynı koşullarla yayımlanır, eklenti ya da değeri büyük ölçüde ondan gelen bir hizmet satılamaz.
- Hata ve öneriler için şablonlarla [issue](https://github.com/OMEREVUR/GitAtlas-Rev/issues) aç; büyük değişiklikten önce issue'da konuşalım.
- Kurulum: `npm install`, `npm run build`, `npm run typecheck`, `npm test`; deneme için VS Code'da F5 (kurulu Marketplace sürümünü o sırada devre dışı bırak).
- Kurallar: strict TypeScript, `any` yok; bağımlılık eklemeden önce sor; webview'da yalnızca `--vscode-*`/`--rr-*` renkleri; kullanıcıya görünen her metin `src/i18n/` sözlüğünde Türkçe + İngilizce; testler makineden bağımsız (`git init -b main`); conventional commits.
- Ayar, komut ve görünüm kimlikleri bilerek `gitatlas-revrev.` önekiyle kalıyor: değiştirmek kullanıcıların ayarlarını sıfırlar.
