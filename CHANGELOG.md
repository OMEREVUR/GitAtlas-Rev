# Changelog

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
