# Changelog

## 0.4.0
Two features from the first feedback round: finding the commit that caused a bug, and moving commits between branches.
- **Bisect tab.** Pick a known-good and a known-bad commit (from the tab or by marking them in the graph), then answer Good / Bad / Skip for each commit that is checked out; a counter shows roughly how many steps are left. The suspect range is dimmed on the graph and marked commits get a label. When the culprit is found, a card lists the files it touched — light them up on the map, show the commit in the graph, or open a diff. **Finish** runs `git bisect reset` and returns you to where you started. A bisect started in a terminal is picked up as well. `git bisect run` is deliberately not supported: GitAtlas-Rev never runs a command you typed.
- **Cherry-pick.** Select one commit, or several with Ctrl/Cmd-click and Shift-click, then "Pick these N commits" in the commit panel — or right-click the selection in the graph. Commits are applied oldest first with `git cherry-pick -x`, so each new commit records where it came from. Two or more commits ask for confirmation.
- The conflict band now also has **Skip** (cherry-pick, rebase and revert; a merge has no `--skip`). Continue, Abort, the resolved counter and the per-file "keep one side" buttons already understood cherry-pick.
- A cherry-pick whose changes are already on the branch is reported as such, with a pointer to Skip, instead of raw git output. A cherry-pick cannot start while a bisect is running, and a bisect cannot start during a merge, rebase, cherry-pick or revert.

## 0.3.1
Maintenance release: nothing changes in how the extension behaves.
- Fixed the Windows CI run. A test built its expected paths from `os.tmpdir()` and compared them with the paths git reports; on runners whose temp directory uses a Windows 8.3 short name (`RUNNER~1`) the two forms never matched.
- GitHub Actions updated to `checkout`, `setup-node` and `upload-artifact` v7; the v4 line targets the deprecated Node.js 20.
- README screenshots retaken on 0.3.0, with the Frequency/Recency color mode and the merge conflict markers added.

## 0.3.0
Usability round based on the first user feedback.
- **Multi-root workspaces:** GitAtlas-Rev now finds the git repository in every workspace folder, not only the first one. Switch repositories with the repository button next to the branch name, the status bar item or **GitAtlas-Rev: Select repository**; optionally follow the repository of the active file. The choice is remembered per workspace.
- **Get started walkthrough** (5 steps with screenshots) and a one-time "Open the map / Take the tour" notification the first time a repository is found.
- **Color mode:** a Frequency / Recency switch on the map. Recency colors files by when they last changed (last 24 hours, 3 days, week, month, older), independent of the time range.
- **Fairer heat scale:** files with the same number of commits now get the lowest rank of their group, so files changed only once no longer look hot in a young repository. Applies to the map, the file card, the time machine and the `all` Explorer badge mode.
- Hint under the map legend: click a commit to light up the files it touched.
- **Merge conflicts:** conflicted files get a red frame and a "!" badge on the map, and a conflict band appears on the other tabs. In the Changes tab every conflicted file has "Open in merge editor", buttons to keep one side (labelled for merge, rebase and cherry-pick; asks for confirmation; deletes the file if that side removed it) and "Mark resolved". The band shows how many files are resolved.
- `make vsix` / `make check` for building and checking (development only).

## 0.2.1
- Marketplace page: screenshots and a time machine GIF in the README, Marketplace/CI badges and an install link.
- `package.json`: repository, issue tracker, homepage, keywords and gallery banner.
- License section in the README: MIT with the Commons Clause condition (source-available, not open source).
- `CONTRIBUTING.md`, issue and pull request templates, GitHub Actions CI (typecheck, test, build on Ubuntu and Windows).
- Tests no longer depend on the machine's git configuration (`init.defaultBranch`, `url.insteadOf`) or speed (timeouts).

## 0.2.0
- English interface. The language follows the VS Code display language by default; new setting `gitatlas-revrev.language` (`auto`, `en`, `tr`).
- Commands, views and settings are localized (`package.nls.json`, `package.nls.tr.json`).
- English README (Turkish: `README.tr.md`).
- Display name is now **GitAtlas-Rev** (extension ID `Omer-Cayir.gitatlas-rev`).

## 0.1.0
- First release (Turkish interface): treemap, commit graph, Branches view, GitHub PR/CI layer, time machine, contributors panel, Changes tab with git operations and pull requests.
