# Checklist smoke для Windows `.exe`

## Среда запуска
- Хост: Windows 10/11
- Артефакт: `dist/WeighingSystem/WeighingSystem.exe`
- Проверка backend URL: `http://127.0.0.1:5001`
- Проверка API: `scripts/smoke_scale_api.py`

## Чеклист
- [ ] Запущен `dist/WeighingSystem/WeighingSystem.exe`
- [ ] Открыт браузер на `http://127.0.0.1:5001`
- [ ] В активном комплекте настроен `serial_backend`
- [ ] Выполнен `connect -> status -> read -> disconnect` (успешные `2xx`)
- [ ] Зафиксирован `session_id` и redacted API ответы
- [ ] Проверен switch `primary -> spare`: старый `session_id` возвращает `409 stale_session`
- [ ] Новая сессия для `spare` успешно читает вес
- [ ] Проверен `disconnect` для новой сессии
- [ ] Проверен security deny: неразрешённый `Origin` даёт `403 origin_not_allowed`
- [ ] Проверен отказ без active operator-session: `401 auth_required`
- [ ] Проверен fallback: при недоступном backend/порту оператор может продолжить вручную (`manual_only`)

## Команды для smoke
```powershell
# 1) Запустить приложение
dist\WeighingSystem\WeighingSystem.exe

# 2) Выполнить API smoke (пример)
py -3.11 scripts\smoke_scale_api.py `
  --base-url http://127.0.0.1:5001 `
  --origin http://127.0.0.1:5001 `
  --expected-site-id default-site `
  --expected-scale-id scale-primary `
  --expected-scale-role primary `
  --write-markdown docs/reports/scale-adapters/scale-adapters-smoke-exe.md `
  --write-json docs/reports/scale-adapters/scale-adapters-smoke-exe.json
```

## Статус текущего прогона
- `2026-07-31`: `BLOCKED` (в этой задаче прогон выполнялся в Linux-окружении без Windows `.exe`)
