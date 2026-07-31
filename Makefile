# Обёртка над orchestrate.sh (agents/01_orchestrator.md).
# Примеры:
#   make orchestrate TASK=docs/tasks/05-scale-adapters.md
#   make orchestrate-queue
#   make orchestrate-dry TASK=docs/tasks/05-scale-adapters.md
#   make orchestrate-from FROM=develop TASK=docs/tasks/05-scale-adapters.md

.PHONY: orchestrate orchestrate-queue orchestrate-dry orchestrate-from test-scale smoke-scale release-check-scale help

TASK ?=
FROM ?= analyze
SMOKE_BASE_URL ?= http://127.0.0.1:5001
SMOKE_ORIGIN ?= http://127.0.0.1:5001
SMOKE_SITE_ID ?= default-site
SMOKE_SCALE_ID ?= scale-primary
SMOKE_SCALE_ROLE ?= primary

help:
	@./orchestrate.sh --help

orchestrate:
	@if [ -z "$(TASK)" ]; then ./orchestrate.sh; else ./orchestrate.sh "$(TASK)"; fi

orchestrate-queue:
	@./orchestrate.sh --queue

orchestrate-dry:
	@if [ -z "$(TASK)" ]; then ./orchestrate.sh --dry-run; else ./orchestrate.sh --dry-run "$(TASK)"; fi

orchestrate-from:
	@test -n "$(TASK)" || (echo "Укажите TASK=docs/tasks/....md" && exit 1)
	@./orchestrate.sh --from "$(FROM)" "$(TASK)"

test-scale:
	@npm run test:scale-runtime
	@npm run test:scale-parity
	@npm run test:scale-server

smoke-scale:
	@python3 scripts/smoke_scale_api.py \
		--base-url "$(SMOKE_BASE_URL)" \
		--origin "$(SMOKE_ORIGIN)" \
		--expected-site-id "$(SMOKE_SITE_ID)" \
		--expected-scale-id "$(SMOKE_SCALE_ID)" \
		--expected-scale-role "$(SMOKE_SCALE_ROLE)" \
		--write-markdown docs/implementation/reports/scale-adapters-smoke.md \
		--write-json docs/implementation/reports/scale-adapters-smoke.json

release-check-scale:
	@make test-scale
	@npm run build
	@test -s docs/implementation/reports/scale-adapters-smoke.md || (echo "Нет docs/implementation/reports/scale-adapters-smoke.md" && exit 1)
	@test -s docs/implementation/reports/scale-adapters-exe-checklist.md || (echo "Нет docs/implementation/reports/scale-adapters-exe-checklist.md" && exit 1)
	@test -s docs/implementation/reports/scale-adapters-acceptance.md || (echo "Нет docs/implementation/reports/scale-adapters-acceptance.md" && exit 1)
