# Установка Claude Code и настройка нескольких агентов

## 1. Установка Claude Code (Windows)

### Вариант A: официальный установщик (рекомендуется)

В **PowerShell** (от администратора не обязательно):

```powershell
irm https://claude.ai/install.ps1 | iex
```

После установки проверка:

```powershell
claude --version
```

### Вариант B: через WinGet

```powershell
winget install Anthropic.ClaudeCode
```

**Требования:** Windows 10+, желательно установленный [Git for Windows](https://git-scm.com/download/win) (для bash-команд в сценариях).

### Первый запуск и авторизация

1. Выполни в терминале: `claude`
2. Откроется браузер для входа в аккаунт Anthropic (нужна подписка Pro или API-ключ с кредитами)
3. После входа можно вызывать Claude из терминала и из расширения в VS Code/Cursor

---

## 2. Как в этом проекте устроены «несколько агентов»

Роли агентов уже описаны в репозитории и подключаются в Cursor и при работе с Claude Code через общий контекст.

### Роли в `ops/agents/`

| Агент | Файл | Назначение |
|-------|------|------------|
| ChiefEngineer | `chief-engineer.system.md` | Планы, назначение задач, гейты релиза |
| FullstackEngineer | `fullstack-engineer.system.md` | Backend + frontend, фичи, API |
| QAEngineer | `qa-engineer.system.md` | Тесты, регрессии, релиз-чеки |
| BlockchainEngineer | `blockchain-engineer.system.md` | Контракты, деплой, безопасность |
| DesignLead | `design-lead.system.md` | UI/UX, контент |
| MarketingLead | `marketing-lead.system.md` | Контент, соцсети |
| MeetingMode | `meeting-mode.system.md` | Совещания, итоги |

Реестр: `ops/agents/registry.yaml`. Общие правила для всех агентов: `ops/agents/agent-contract.md`.

### Cursor: правила по папкам (псевдо-агенты)

В `.cursor/rules/` добавлены правила, которые автоматически подключают нужный «профиль» в зависимости от того, с какими файлами ты работаешь:

- **backend/** — акцент на стабильности API, контрактах, env, тестах бэкенда
- **frontend/** — акцент на компонентах, i18n, типах, тестах фронта
- **contracts/** — акцент на Solidity, деплое, безопасности
- **тесты** (`*.test.*`, `*.spec.*`) — акцент на покрытии и блокировке релиза при падениях

В чате Cursor можно явно написать: «действуй как QAEngineer» и сослаться на `ops/agents/qa-engineer.system.md`.

### Claude Code в терминале

В корне проекта:

```powershell
cd D:\OAI
claude
```

Claude подхватит контекст из `CLAUDE.md` в корне. Можно устно указать роль, например: «действуй как FullstackEngineer, добавь эндпоинт X в backend и кнопку на фронте».

---

## 3. Продолжение разработки и тестирования

- **Разработка фич:** опираться на `ops/agents/fullstack-engineer.system.md` и `ops/agents/blockchain-engineer.system.md` (если трогаешь контракты). В Cursor при открытии файлов из `backend/` или `frontend/` применяются соответствующие правила из `.cursor/rules/`.
- **Тестирование:** роль QAEngineer, `ops/agents/qa-engineer.system.md`; в Cursor при открытии тестовых файлов применяется правило из `.cursor/rules/testing-agent.mdc`. Релиз блокировать при падающих критичных тестах.
- **Релиз:** ChiefEngineer, чек-листы, деплой через `.github/workflows/deploy-autopilot.yml` (Render + Vercel при наличии секретов).

---

## 4. Краткий чек-лист

- [ ] Установлен Claude Code (`claude --version`)
- [ ] Выполнен первый вход (`claude` → браузер)
- [ ] В корне проекта есть `CLAUDE.md` (уже создан)
- [ ] В Cursor подключены правила из `.cursor/rules/`
- [ ] При необходимости явно указываешь роль: «действуй как QAEngineer» и т.п.

После этого и Cursor, и Claude Code в терминале могут продолжать разработку и тестирование проекта в режиме нескольких агентов.
