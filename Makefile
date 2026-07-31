# Обёртка над orchestrate.sh (agents/01_orchestrator.md).
# Примеры:
#   make orchestrate TASK=docs/tasks/05-scale-adapters.md
#   make orchestrate-queue
#   make orchestrate-dry TASK=docs/tasks/05-scale-adapters.md
#   make orchestrate-from FROM=develop TASK=docs/tasks/05-scale-adapters.md

.PHONY: orchestrate orchestrate-queue orchestrate-dry orchestrate-from help

TASK ?=
FROM ?= analyze

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
