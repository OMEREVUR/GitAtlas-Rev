# GitAtlas-Rev

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/Omer-Cayir.gitatlas-rev?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=Omer-Cayir.gitatlas-rev)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Omer-Cayir.gitatlas-rev)](https://marketplace.visualstudio.com/items?itemName=Omer-Cayir.gitatlas-rev)
[![CI](https://github.com/OMEREVUR/GitAtlas-Rev/actions/workflows/ci.yml/badge.svg)](https://github.com/OMEREVUR/GitAtlas-Rev/actions/workflows/ci.yml)

*Türkçe: [README.tr.md](README.tr.md)*

A map that lets you read a repo at a glance. GitAtlas-Rev draws your repository as a **treemap** in the VS Code side panel: every box is a file, its size is the line count, its color is how often it changes (churn). On top of that come a commit graph, branches, open pull requests on GitHub, a time machine and a contributors panel.

The interface is available in **English** and **Turkish**. It follows the VS Code display language by default; change it with the `gitatlas-revrev.language` setting.

![The map: box size is line count, color is churn; a dashed purple frame marks a file touched by two open PRs](https://github.com/OMEREVUR/GitAtlas-Rev/releases/download/v0.2.1/01-map-pr-conflict-dark.png)

**[Install from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Omer-Cayir.gitatlas-rev)**, or press `Ctrl+P` in VS Code and run `ext install Omer-Cayir.gitatlas-rev`. Then open the **GitAtlas-Rev** icon in the Activity Bar, or follow the **Get started with GitAtlas-Rev** walkthrough (Help → Welcome).

## Features

**Map**
- Repo treemap: folders are nested boxes; click a folder header to drill in, Backspace to go back up.
- Time range: 7 days / 30 days / all.
- File card: recent commits, "Open file", and a "Diff" for every commit.
- Recent commits feed: click a commit and the files it touched light up on the map.
- Color mode: **Frequency** (how many commits changed a file in the selected range) or **Recency** (when it last changed: last 24 hours, 3 days, week, month, older).
- Explorer badges: ●● / ● next to frequently changed files, even while the panel is closed.
- The map can also be opened as an editor tab: **GitAtlas-Rev: Open map in editor**.
- Several repositories in one workspace (multi-root): switch with the repository button next to the branch name, the status bar or **GitAtlas-Rev: Select repository**; the map can also follow the repository of the active file.

![A selected commit lights up the files it touched; the rest of the map is dimmed](https://github.com/OMEREVUR/GitAtlas-Rev/releases/download/v0.2.1/02-commit-highlight-light.png)

**Graph and branches**
- Commit graph: branches as colored lanes, merges as hollow dots. Filter by branch, author, date and text (message, file, hash); older commits load as you scroll.
- Branches view: local and remote branches, ahead/behind, last touched; branches untouched for more than 30 days are marked "stale".
- Select a commit or branch in the graph or the Branches view and its files light up on the map.

![Commit graph with branch lanes, PR and CI badges, and a mini map of the selected commit](https://github.com/OMEREVUR/GitAtlas-Rev/releases/download/v0.2.1/03-graph-dark.png)

**GitHub layer**
- **PR conflict warning:** when 2+ open PRs touch the same file, its box gets a purple dashed frame; the file card lists the PRs; the Explorer shows a PR count badge.
- PR and CI badges in the graph and the Branches view.
- No token needed: your built-in VS Code GitHub session is used (**GitAtlas-Rev: Connect to GitHub**). If `origin` is not on GitHub, the layer simply stays off.

**Time machine and contributors**
- Time machine: use the slider or the play button to see the repo at a past date; heat is the change in the 7 days before that date, and files that did not exist yet have a dashed outline.
- Contributors panel: module ownership (with a "single owner" warning), weekly rhythm, "who knows this file best", authors. Multiple emails of the same person are merged via `.mailmap`.

![Time machine: the repo growing from its first commit to today](https://github.com/OMEREVUR/GitAtlas-Rev/releases/download/v0.2.1/08-time-machine.gif)

![Contributors panel: module ownership, weekly rhythm and who knows each file best](https://github.com/OMEREVUR/GitAtlas-Rev/releases/download/v0.2.1/05-contributors-dark.png)

**Changes: git without typing commands**
- **Changes** tab: stage or unstage changed files one by one or all at once with checkboxes, view the diff, discard a change.
- Commit box: type picker (feat, fix…), summary counter, "Commit & push", amend last commit, undo last commit; the git command that will run is shown below.
- Sync bar on every tab: Fetch, Pull, Push ("Publish" on a new branch). Pull tries fast-forward first and asks merge or rebase if that is not possible.
- Right-click in the Branches view: switch, new branch, merge, rename, delete. Stashes: stash, apply, drop.
- Merge conflicts: conflicted files get a red frame and a "!" badge on the map. In the Changes tab, open each file in the merge editor, keep one side (labelled for merge, rebase and cherry-pick) or mark it resolved; a counter shows how many files are resolved, then Continue or Abort.
- When connected to GitHub, **Pull requests**: open a PR from this branch (pushes first if needed), merge a PR (merge/squash/rebase), check out a PR branch; "My pull requests" and "Review requested".
- Every risky action asks for confirmation first; commands and their output are in the "GitAtlas-Rev Git" output channel.

![Changes tab: stage with checkboxes, commit box and pull requests](https://github.com/OMEREVUR/GitAtlas-Rev/releases/download/v0.2.1/06-changes-pr-dark.png)

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitatlas-revrev.language` | `auto` | Interface language: `auto` (follows VS Code), `en`, `tr`. |
| `gitatlas-revrev.ignore` | `[]` | Extra glob patterns to exclude from the map and badges. `node_modules`, `dist`, `out`, `build`, `*.lock`, `package-lock.json`, `*.min.js` are already excluded. |
| `gitatlas-revrev.defaultRange` | `30d` | Time range selected when the panel opens. |
| `gitatlas-revrev.graph.initialCommits` | `500` | Number of commits loaded first in the graph. |
| `gitatlas-revrev.explorer.badges` | `hot` | Explorer badges: `hot` (●● / ●), `all` (heat 1–5), `off`. |
| `gitatlas-revrev.github.enabled` | `true` | GitHub layer. |
| `gitatlas-revrev.github.refreshInterval` | `2` | GitHub refresh interval (minutes); only while the panel is open, backs off automatically when the rate limit runs low. |
| `gitatlas-revrev.git.pullStrategy` | `ask` | When a pull cannot fast-forward: `ask`, `merge`, `rebase`. |
| `gitatlas-revrev.git.path` | `""` | Path to git; if empty, VS Code's `git.path` setting or `git` on PATH. |

## Privacy

- GitAtlas-Rev has **no server of its own**; no data is sent anywhere.
- Git data is read only on your machine with local `git` commands; actions in the Changes tab also run through local `git` (your pre-commit hooks run). Results are cached in VS Code's extension storage (globalStorage), one file per repo.
- Push/pull first use git's own credentials; if that fails and you are connected to GitHub, it retries once with your VS Code GitHub session (the token is never written to disk or logged).
- The GitHub layer runs only after you connect. Requests go directly to `api.github.com` with your VS Code GitHub session; GitAtlas-Rev does not store the token. The fetched PR/CI summary is also cached only locally.

## Development

```
npm install
npm run build        # dist/extension.js + dist/webview.js
npm test             # vitest
npm run typecheck
```

To build a VSIX: `make vsix` (or `node scripts/package-vsix.mjs` without make); it typechecks first and writes `Extension-Versions/gitatlas-rev-<version>.vsix`.

Press **F5** in VS Code to open the Extension Development Host. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or a pull request.

## License

GitAtlas-Rev is **source-available**, not open source: it is licensed under MIT with the [Commons Clause](https://commonsclause.com/) condition (see [LICENSE](LICENSE)). You may use, modify and share it, but you may not sell it, or a product or service whose value derives substantially from it. Because this combination is not an OSI-approved license, GitHub does not show a license name for the repository.
