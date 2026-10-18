# GitAtlas-Rev shortcuts. The work is done by npm scripts and scripts/*.mjs,
# so the recipes stay the same whether make runs them with cmd or sh.

.PHONY: help vsix check
.DEFAULT_GOAL := help

help:
	@echo make vsix          - typecheck, then build Extension-Versions/gitatlas-rev-VERSION.vsix
	@echo make vsix FORCE=1  - same, overwriting an existing VSIX of that version
	@echo make check         - typecheck and run all tests

vsix:
	node scripts/package-vsix.mjs $(if $(FORCE),--force)

check:
	npm run typecheck
	npm test
