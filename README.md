# GitAtlas-RevRev

*Türkçe açıklama: `README.tr.md`.*

A map that lets you read a repo at a glance. GitAtlas-RevRev draws your repository as a **treemap** in the VS Code side panel: every box is a file, its size is the line count, its color is how often it changes (churn). On top of that come a commit graph, branches, open pull requests on GitHub, a time machine and a contributors panel.

The interface is available in **English** and **Turkish**. It follows the VS Code display language by default; change it with the `gitatlas-revrev.language` setting.

## Features

**Map**
- Repo treemap: folders are nested boxes; click a folder header to drill in, Backspace to go back up.
- Time range: 7 days / 30 days / all.
- File card: recent commits, "Open file", and a "Diff" for every commit.
- Recent commits feed: click a commit and the files it touched light up on the map.
- Explorer badges: ●● / ● next to frequently changed files, even while the panel is closed.
- The map can also be opened as an editor tab: **GitAtlas-RevRev: Open map in editor**.

**Graph and branches**
- Commit graph: branches as colored lanes, merges as hollow dots. Filter by branch, author, date and text (message, file, hash); older commits load as you scroll.
- Branches view: local and remote branches, ahead/behind, last touched; branches untouched for more than 30 days are marked "stale".
- Select a commit or branch in the graph or the Branches view and its files light up on the map.

**GitHub layer**
- **PR conflict warning:** when 2+ open PRs touch the same file, its box gets a purple dashed frame; the file card lists the PRs; the Explorer shows a PR count badge.
- PR and CI badges in the graph and the Branches view.
- No token needed: your built-in VS Code GitHub session is used (**GitAtlas-RevRev: Connect to GitHub**). If `origin` is not on GitHub, the layer simply stays off.

**Time machine and contributors**
- Time machine: use the slider or the play button to see the repo at a past date; heat is the change in the 7 days before that date, and files that did not exist yet have a dashed outline.
- Contributors panel: module ownership (with a "single owner" warning), weekly rhythm, "who knows this file best", authors. Multiple emails of the same person are merged via `.mailmap`.

**Changes: git without typing commands**
- **Changes** tab: stage or unstage changed files one by one or all at once with checkboxes, view the diff, discard a change.
- Commit box: type picker (feat, fix…), summary counter, "Commit & push", amend last commit, undo last commit; the git command that will run is shown below.
- Sync bar on every tab: Fetch, Pull, Push ("Publish" on a new branch). Pull tries fast-forward first and asks merge or rebase if that is not possible.
- Right-click in the Branches view: switch, new branch, merge, rename, delete. Stashes: stash, apply, drop. During a conflict: "Mark resolved / Continue / Abort".
- When connected to GitHub, **Pull requests**: open a PR from this branch (pushes first if needed), merge a PR (merge/squash/rebase), check out a PR branch; "My pull requests" and "Review requested".
- Every risky action asks for confirmation first; commands and their output are in the "GitAtlas-RevRev Git" output channel.

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

- GitAtlas-RevRev has **no server of its own**; no data is sent anywhere.
- Git data is read only on your machine with local `git` commands; actions in the Changes tab also run through local `git` (your pre-commit hooks run). Results are cached in VS Code's extension storage (globalStorage), one file per repo.
- Push/pull first use git's own credentials; if that fails and you are connected to GitHub, it retries once with your VS Code GitHub session (the token is never written to disk or logged).
- The GitHub layer runs only after you connect. Requests go directly to `api.github.com` with your VS Code GitHub session; GitAtlas-RevRev does not store the token. The fetched PR/CI summary is also cached only locally.

## Development

```
npm install
npm run build        # dist/extension.js + dist/webview.js
npm test             # vitest
npm run typecheck
```

Press **F5** in VS Code to open the Extension Development Host. See `CLAUDE.md` for details and other commands.
