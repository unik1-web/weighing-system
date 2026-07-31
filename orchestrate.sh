#!/usr/bin/env bash
# Оркестратор мультиагентной разработки (agents/01_orchestrator.md).
#
# Использование:
#   ./orchestrate.sh docs/tasks/05-scale-adapters.md
#   ./orchestrate.sh --task docs/tasks/05-scale-adapters.md
#   ./orchestrate.sh --queue                 # все невыполненные (без «Статус: реализовано»)
#   ./orchestrate.sh --from develop          # продолжить с этапа (analyze|review-tz|architect|...)
#   ./orchestrate.sh --dry-run docs/tasks/05-scale-adapters.md
#
# Требования: Cursor CLI (`agent login` или CURSOR_API_KEY), submodule agents/.
#
# Модели (как в README):
#   аналитик, архитектор, планировщик — gpt-5.4-high
#   ревьюеры и разработчик            — gpt-5.3-codex

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL_HIGH="${MODEL_HIGH:-gpt-5.4-high}"
MODEL_CODEX="${MODEL_CODEX:-gpt-5.3-codex}"

PROMPTS_DIR="${PROMPTS_DIR:-agents}"
TASKS_DIR="${TASKS_DIR:-docs/tasks}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-docs/implementation}"
PROJECT_DESC="${PROJECT_DESC:-docs/project-for-agents.md}"
EXTRA_CONTEXT="${EXTRA_CONTEXT:-docs/architecture.md docs/api.md README.md}"
LOG_DIR="${LOG_DIR:-logs/orchestrate}"

DRY_RUN=0
FROM_STEP="analyze"
QUEUE_MODE=0
TASK_FILE=""
MAX_TZ_LOOPS=2
MAX_ARCH_LOOPS=2
MAX_PLAN_LOOPS=2
MAX_CODE_LOOPS=2

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

log()  { printf '%s\n' "$*"; }
die()  { printf '%s\n' "$*" >&2; exit 1; }
hr()   { printf '%s\n' "========================================="; }

require_agent() {
  command -v "$AGENT_BIN" >/dev/null 2>&1 || die "Не найден '$AGENT_BIN'. Установите: https://cursor.com/install"
  if ! "$AGENT_BIN" status 2>/dev/null | grep -qiE 'logged in|email|Authenticated|Subscription'; then
    # status formats vary; try a cheap models call
    if ! "$AGENT_BIN" models >/dev/null 2>&1; then
      die "CLI не аутентифицирован. Выполните: agent login  или задайте CURSOR_API_KEY"
    fi
  fi
}

# Собирает промпт: содержимое роли + входные данные (формат README).
build_prompt() {
  local role_file="$1"
  shift
  [[ -f "$role_file" ]] || die "Нет файла роли: $role_file"
  {
    cat "$role_file"
    printf '\n\n---\n## ВХОДНЫЕ ДАННЫЕ ОРКЕСТРАТОРА\n\n'
    printf '%s\n' "$@"
  }
}

run_agent() {
  local role_name="$1"
  local model="$2"
  local role_file="$3"
  shift 3
  local prompt
  prompt="$(build_prompt "$role_file" "$@")"

  hr
  log ">> Агент: $role_name"
  log "role: Роль:  $role_file"
  log "model: Модель: $model"
  hr

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] промпт (${#prompt} байт), запуск пропущен"
    return 0
  fi

  mkdir -p "$LOG_DIR"
  local stamp log_file prompt_file
  stamp="$(date +%Y%m%d_%H%M%S)"
  local role_slug
  # ASCII slug: кириллица иначе превращается в '____'
  role_slug="$(printf '%s' "$role_name" | iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null || printf '%s' "$role_name")"
  role_slug="$(printf '%s' "$role_slug" | tr '[:upper:]' '[:lower:]' | tr -cs 'A-Za-z0-9' '_' | sed 's/^_//;s/_$//')"
  [[ -n "$role_slug" ]] || role_slug="agent"
  log_file="${LOG_DIR}/${stamp}_${role_slug}.log"
  prompt_file="${LOG_DIR}/${stamp}_${role_slug}.prompt.md"
  printf '%s' "$prompt" >"$prompt_file"

  set +e
  # Формат README: agent -f --model {модель} -p {промпт}
  # Промпт = содержимое роли + входные данные (во временном файле из‑за размера).
  "$AGENT_BIN" -f --trust --workspace "$ROOT" --model "$model" \
    -p --output-format text "$(cat "$prompt_file")" \
    >"$log_file" 2>&1
  local rc=$?
  set -e

  tail -n 40 "$log_file" || true
  log "Лог: $log_file"
  log "Промпт: $prompt_file"

  [[ $rc -eq 0 ]] || die "Агент '$role_name' завершился с кодом $rc"
  log "OK: $role_name"
}

json_field_true() {
  # Ищет "field": true в логе/файле (грубый парсер для has_critical_issues)
  local file="$1" field="$2"
  [[ -f "$file" ]] || return 1
  grep -E "\"$field\"[[:space:]]*:[[:space:]]*true" "$file" >/dev/null 2>&1
}

# Critical review: JSON в файле/логе ИЛИ markdown-статус БЛОКИРУЕТ / has_critical_issues
review_has_critical() {
  local review_file="$1"
  shift
  local logs=("$@")
  if [[ -f "$review_file" ]]; then
    json_field_true "$review_file" "has_critical_issues" && return 0
    grep -Eiq 'has_critical_issues[[:space:]]*[:=][[:space:]]*true' "$review_file" && return 0
    grep -Eq '^\*\*Статус:\*\*[[:space:]]*БЛОКИРУЕТ' "$review_file" && return 0
    grep -Eq '^БЛОКИРОВАТЬ[[:space:]]*$' "$review_file" && return 0
  fi
  local f
  for f in "${logs[@]}"; do
    [[ -f "$f" ]] || continue
    json_field_true "$f" "has_critical_issues" && return 0
  done
  return 1
}

latest_log() {
  # Ищем свежий лог по подстроке в имени (латиница/ASCII slug)
  local pattern="$1"
  ls -1t "$LOG_DIR"/*"${pattern}"*.log 2>/dev/null | head -1 || true
}

has_blocking_questions() {
  local tz_json_hint="$1"
  # В логе аналитика или в status: непустой blocking_questions
  if grep -E '"blocking_questions"[[:space:]]*:[[:space:]]*\[[^]]+\]' "$tz_json_hint" >/dev/null 2>&1; then
    # пустой массив [] — ок; непустой — стоп
    if grep -E '"blocking_questions"[[:space:]]*:[[:space:]]*\[\s*\]' "$tz_json_hint" >/dev/null 2>&1; then
      return 1
    fi
    return 0
  fi
  return 1
}

archive_artifacts() {
  local tag="$1"
  mkdir -p "$ARTIFACTS_DIR"
  local dest="${ARTIFACTS_DIR}/_archive_${tag}_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$dest"
  shopt -s nullglob
  local moved=0
  for f in "$ARTIFACTS_DIR"/*; do
    local base
    base="$(basename "$f")"
    [[ "$base" == .gitkeep ]] && continue
    [[ "$base" == _archive_* ]] && continue
    mv "$f" "$dest/"
    moved=1
  done
  shopt -u nullglob
  if [[ "$moved" -eq 1 ]]; then
    log "Артефакты предыдущего прогона → $dest"
  fi
}

write_status() {
  mkdir -p "$ARTIFACTS_DIR"
  cat >"$ARTIFACTS_DIR/status.md" <<EOF
# Статус выполнения задачи

**Постановка:** \`${TASK_FILE}\`
**artifacts_dir:** \`${ARTIFACTS_DIR}\`

## Этапы
$1

## Заблокировано окружением
- (обновляет оркестратор/агенты)

## Текущий этап
$2
EOF
}

list_pending_tasks() {
  shopt -s nullglob
  local f
  for f in "$TASKS_DIR"/[0-9][0-9]-*.md; do
    if grep -qE '\*\*Статус:\*\*[[:space:]]*реализовано' "$f"; then
      continue
    fi
    printf '%s\n' "$f"
  done
  shopt -u nullglob
}

# --- Разбор аргументов ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --queue) QUEUE_MODE=1; shift ;;
    --from)
      FROM_STEP="${2:-}"; shift 2
      [[ -n "$FROM_STEP" ]] || die "--from требует имя шага"
      ;;
    --task)
      TASK_FILE="${2:-}"; shift 2
      ;;
    --artifacts-dir)
      ARTIFACTS_DIR="${2:-}"; shift 2
      ;;
    --model-high)
      MODEL_HIGH="${2:-}"; shift 2
      ;;
    --model-codex)
      MODEL_CODEX="${2:-}"; shift 2
      ;;
    -*)
      die "Неизвестный флаг: $1"
      ;;
    *)
      TASK_FILE="$1"; shift
      ;;
  esac
done

STEPS_ORDER=(analyze review-tz architect review-arch plan review-plan develop review-code)
step_index() {
  local name="$1" i
  for i in "${!STEPS_ORDER[@]}"; do
    [[ "${STEPS_ORDER[$i]}" == "$name" ]] && { echo "$i"; return 0; }
  done
  return 1
}

should_run() {
  local step="$1"
  local from_i step_i
  from_i="$(step_index "$FROM_STEP")" || die "Неизвестный --from=$FROM_STEP (ожидается: ${STEPS_ORDER[*]})"
  step_i="$(step_index "$step")" || die "Внутренняя ошибка: шаг $step"
  [[ "$step_i" -ge "$from_i" ]]
}

run_pipeline_for_task() {
  local task="$1"
  [[ -f "$task" ]] || die "Нет файла постановки: $task"
  TASK_FILE="$task"
  local task_base
  task_base="$(basename "$task" .md)"

  log ""
  hr
  log "Оркестрация: $task"
  log "logs: Корень: $ROOT"
  log "artifacts: Артефакты: $ARTIFACTS_DIR"
  hr

  mkdir -p "$ARTIFACTS_DIR"
  if [[ "$FROM_STEP" == "analyze" ]]; then
    archive_artifacts "$task_base"
  fi
  write_status "- [ ] Анализ" "Инициализация"

  local common_inputs
  common_inputs="$(cat <<EOF
- Постановка задачи: ${task}
- Описание проекта: ${PROJECT_DESC}
- Доп. контекст: ${EXTRA_CONTEXT}
- Каталог артефактов пайплайна (artifacts_dir): ${ARTIFACTS_DIR}
- Рабочий корень репозитория: ${ROOT}

Правила:
- Пиши markdown-артефакты ТОЛЬКО в ${ARTIFACTS_DIR}/
- НЕ коммить изменения
- UI/документы продукта — на русском где применимо
- В конце ответа всегда выведи итоговый JSON согласно файлу роли
EOF
)"

  local last_log=""
  local loop

  # ===== 1. Анализ (+ review/repair до 2 циклов) =====
  if should_run analyze || should_run review-tz; then
    for ((loop=1; loop<=MAX_TZ_LOOPS; loop++)); do
      if should_run analyze || [[ "$loop" -gt 1 ]]; then
        write_status "- [ ] Анализ — итерация ${loop}/${MAX_TZ_LOOPS}" "Анализ"
        if [[ "$loop" -eq 1 ]]; then
          run_agent "Аналитик" "$MODEL_HIGH" "${PROMPTS_DIR}/02_analyst_prompt.md" "$common_inputs"
        else
          run_agent "Аналитик (доработка)" "$MODEL_HIGH" "${PROMPTS_DIR}/02a_analysis_repair_prompt.md" \
            "$common_inputs
- Исходное ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Замечания ревьюера: ${ARTIFACTS_DIR}/tz_review.md"
        fi
        last_log="$(ls -1t "$LOG_DIR"/*Аналитик*.log 2>/dev/null | head -1 || true)"
        if [[ -n "$last_log" ]] && has_blocking_questions "$last_log"; then
          die "Аналитик вернул blocking_questions — остановите пайплайн и ответьте на вопросы (см. $last_log)"
        fi
      fi

      if should_run review-tz || [[ "$loop" -gt 1 ]]; then
        write_status "- [ ] Анализ — review ${loop}/${MAX_TZ_LOOPS}" "Review ТЗ"
        run_agent "Ревьюер ТЗ" "$MODEL_CODEX" "${PROMPTS_DIR}/03_tz_reviewer_prompt.md" \
          "$common_inputs
- Файл с ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Исходная постановка: ${task}
- Описание проекта: ${PROJECT_DESC}"
        last_log="$(latest_log review)"
        local review_file="${ARTIFACTS_DIR}/tz_review.md"
        if review_has_critical "$review_file" "$last_log"; then
          if [[ "$loop" -lt "$MAX_TZ_LOOPS" ]]; then
            log "WARN: Критичные замечания ТЗ — доработка (цикл $loop)"
            continue
          fi
          die "Критичные замечания ТЗ после ${MAX_TZ_LOOPS} циклов — нужна эскалация (см. ${review_file})"
        fi
        # нет critical → дальше
        break
      fi
      break
    done
  fi

  # ===== 2. Архитектура =====
  if should_run architect || should_run review-arch; then
    for ((loop=1; loop<=MAX_ARCH_LOOPS; loop++)); do
      if should_run architect || [[ "$loop" -gt 1 ]]; then
        write_status "- [x] Анализ — утверждено
- [ ] Архитектура — итерация ${loop}/${MAX_ARCH_LOOPS}" "Архитектура"
        if [[ "$loop" -eq 1 ]]; then
          run_agent "Архитектор" "$MODEL_HIGH" "${PROMPTS_DIR}/04_architect_prompt.md" \
            "$common_inputs
- Утверждённое ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Описание проекта: ${PROJECT_DESC}
- Существующая архитектура продукта: docs/architecture.md
- API: docs/api.md"
        else
          run_agent "Архитектор (доработка)" "$MODEL_HIGH" "${PROMPTS_DIR}/04a_architecture_repair_prompt.md" \
            "$common_inputs
- Архитектура: ${ARTIFACTS_DIR}/architecture.md
- Замечания: ${ARTIFACTS_DIR}/architecture_review.md
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md"
        fi
      fi

      if should_run review-arch || [[ "$loop" -gt 1 ]]; then
        run_agent "Ревьюер архитектуры" "$MODEL_CODEX" "${PROMPTS_DIR}/05_architecture_reviewer_prompt.md" \
          "$common_inputs
- Архитектура: ${ARTIFACTS_DIR}/architecture.md
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Описание проекта: ${PROJECT_DESC}"
        last_log="$(latest_log review)"
        if review_has_critical "${ARTIFACTS_DIR}/architecture_review.md" "$last_log"; then
          if [[ "$loop" -lt "$MAX_ARCH_LOOPS" ]]; then
            log "WARN: Критичные замечания архитектуры — доработка"
            continue
          fi
          die "Критичные замечания архитектуры после ${MAX_ARCH_LOOPS} циклов"
        fi
        break
      fi
      break
    done
  fi

  # ===== 3. План =====
  if should_run plan || should_run review-plan; then
    for ((loop=1; loop<=MAX_PLAN_LOOPS; loop++)); do
      if should_run plan || [[ "$loop" -gt 1 ]]; then
        write_status "- [x] Анализ — утверждено
- [x] Архитектура — утверждено
- [ ] Планирование — итерация ${loop}/${MAX_PLAN_LOOPS}" "Планирование"
        if [[ "$loop" -eq 1 ]]; then
          run_agent "Планировщик" "$MODEL_HIGH" "${PROMPTS_DIR}/06_agent_planner.md" \
            "$common_inputs
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Архитектура: ${ARTIFACTS_DIR}/architecture.md
- Описание проекта: ${PROJECT_DESC}"
        else
          run_agent "Планировщик (доработка)" "$MODEL_HIGH" "${PROMPTS_DIR}/06a_agent_planning_repair.md" \
            "$common_inputs
- План: ${ARTIFACTS_DIR}/plan.md
- Замечания: ${ARTIFACTS_DIR}/plan_review.md
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Архитектура: ${ARTIFACTS_DIR}/architecture.md"
        fi
      fi

      if should_run review-plan || [[ "$loop" -gt 1 ]]; then
        run_agent "Ревьюер плана" "$MODEL_CODEX" "${PROMPTS_DIR}/07_agent_plan_reviewer.md" \
          "$common_inputs
- План: ${ARTIFACTS_DIR}/plan.md
- Задачи: ${ARTIFACTS_DIR}/tasks/
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Архитектура: ${ARTIFACTS_DIR}/architecture.md"
        last_log="$(latest_log review)"
        if review_has_critical "${ARTIFACTS_DIR}/plan_review.md" "$last_log"; then
          if [[ "$loop" -lt "$MAX_PLAN_LOOPS" ]]; then
            log "WARN: Критичные замечания плана — доработка"
            continue
          fi
          die "Критичные замечания плана после ${MAX_PLAN_LOOPS} циклов"
        fi
        break
      fi
      break
    done
  fi

  # ===== 4. Разработка по задачам плана + review кода =====
  if should_run develop; then
    write_status "- [x] Анализ — утверждено
- [x] Архитектура — утверждено
- [x] Планирование — утверждено
- [ ] Разработка — в процессе" "Разработка"

    shopt -s nullglob
    local plan_tasks=("${ARTIFACTS_DIR}"/tasks/task_*.md)
    shopt -u nullglob

    if [[ "${#plan_tasks[@]}" -eq 0 ]]; then
      log "WARN: Нет ${ARTIFACTS_DIR}/tasks/task_*.md — один прогон разработчика по plan.md"
      run_agent "Разработчик" "$MODEL_CODEX" "${PROMPTS_DIR}/08_agent_developer.md" \
        "$common_inputs
- План: ${ARTIFACTS_DIR}/plan.md
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Архитектура: ${ARTIFACTS_DIR}/architecture.md
- Выполни все задачи плана с реальной логикой; отчёт в ${ARTIFACTS_DIR}/reports/"
    else
      local t
      for t in "${plan_tasks[@]}"; do
        log "--- Задача плана: $(basename "$t") ---"
        run_agent "Разработчик" "$MODEL_CODEX" "${PROMPTS_DIR}/08_agent_developer.md" \
          "$common_inputs
- Описание задачи: ${t}
- План: ${ARTIFACTS_DIR}/plan.md
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Архитектура: ${ARTIFACTS_DIR}/architecture.md
- Код проекта: ${ROOT}
- Отчёты: ${ARTIFACTS_DIR}/reports/"
      done
    fi
  fi

  if should_run review-code; then
    for ((loop=1; loop<=MAX_CODE_LOOPS; loop++)); do
      run_agent "Ревьюер кода" "$MODEL_CODEX" "${PROMPTS_DIR}/09_agent_code_reviewer.md" \
        "$common_inputs
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Архитектура: ${ARTIFACTS_DIR}/architecture.md
- План: ${ARTIFACTS_DIR}/plan.md
- Проверь изменения относительно постановки ${task}"
      last_log="$(latest_log review)"
      if review_has_critical "${ARTIFACTS_DIR}/code_review.md" "$last_log"; then
        if [[ "$loop" -lt "$MAX_CODE_LOOPS" ]]; then
          log "WARN: Критичные замечания кода — repair"
          run_agent "developer-repair" "$MODEL_CODEX" "${PROMPTS_DIR}/08a_agent_implementation_repair.md" \
            "$common_inputs
- Замечания: ${ARTIFACTS_DIR}/code_review.md
- ТЗ: ${ARTIFACTS_DIR}/technical_specification.md
- Архитектура: ${ARTIFACTS_DIR}/architecture.md"
          continue
        fi
        die "Критичные замечания кода после ${MAX_CODE_LOOPS} циклов"
      fi
      break
    done
  fi

  write_status "- [x] Анализ — утверждено
- [x] Архитектура — утверждено
- [x] Планирование — утверждено
- [x] Разработка — утверждено" "Завершено (проверьте status/code_review вручную)"

  hr
  log "Пайплайн для ${task} завершён"
  log "artifacts: Артефакты: ${ARTIFACTS_DIR}"
  log "logs: Логи: ${LOG_DIR}"
  hr
}

# --- main ---
mkdir -p "$LOG_DIR" "$ARTIFACTS_DIR"
[[ "$DRY_RUN" -eq 1 ]] || require_agent
[[ -d "$PROMPTS_DIR" ]] || die "Нет каталога промптов: $PROMPTS_DIR (git submodule update --init --recursive)"

if [[ "$QUEUE_MODE" -eq 1 ]]; then
  mapfile -t PENDING < <(list_pending_tasks)
  [[ "${#PENDING[@]}" -gt 0 ]] || die "Нет невыполненных задач в ${TASKS_DIR}"
  log "Очередь (${#PENDING[@]}):"
  printf '  - %s\n' "${PENDING[@]}"
  for t in "${PENDING[@]}"; do
    FROM_STEP="analyze"
    run_pipeline_for_task "$t"
  done
elif [[ -n "$TASK_FILE" ]]; then
  run_pipeline_for_task "$TASK_FILE"
else
  # По умолчанию — следующий pending
  mapfile -t PENDING < <(list_pending_tasks)
  [[ "${#PENDING[@]}" -gt 0 ]] || die "Укажите задачу: ./orchestrate.sh docs/tasks/05-scale-adapters.md"
  log "Автовыбор следующей задачи: ${PENDING[0]}"
  run_pipeline_for_task "${PENDING[0]}"
fi
