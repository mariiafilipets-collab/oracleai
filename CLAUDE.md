# OracleAI Predict — контекст для Claude Code и агентов

## Что это за проект

Децентрализованная платформа предсказаний на BNB Chain: контракты (Solidity), бэкенд (Node.js/Express), фронтенд (Next.js 14). Локально — Hardhat + in-memory MongoDB; прод — Render (backend), Vercel (frontend), BSC Testnet.

## Структура репозитория

- **contracts/** — Solidity (Hardhat), деплой в `deployments/{network}.json`
- **backend/** — Node.js, Express, MongoDB, OpenRouter AI, ethers.js, cron/scheduler
- **frontend/** — Next.js 14, i18n, wallet (wagmi/viem)
- **ops/agents/** — роли агентов (ChiefEngineer, FullstackEngineer, QAEngineer, BlockchainEngineer, DesignLead, MarketingLead, MeetingMode), см. `ops/agents/registry.yaml`

## Как запускать локально

1. `cd contracts && npx hardhat node`
2. В другом терминале: `npx hardhat run scripts/deploy.js --network localhost`
3. `cd backend && npm run dev` (порт 3001)
4. `cd frontend && npm run dev` (порт 3000)

Backend по умолчанию использует in-memory MongoDB; для прод — `MONGODB_URI` и `RPC_URL` в env.

## Агенты и кто за что отвечает

- **FullstackEngineer** — backend + frontend, фичи, API, стабильность.
- **QAEngineer** — тесты, регрессии, релиз-чеки, go/no-go.
- **BlockchainEngineer** — контракты, деплой, безопасность.
- **ChiefEngineer** — планы, назначение задач, гейты релиза.

При разработке: следовать системным промптам в `ops/agents/*.system.md` и общему контракту `ops/agents/agent-contract.md`. При тестировании — чек-листы и блокировка релиза при падающих критичных тестах.

## Важные пути

- Конфиг бэкенда: `backend/src/config/index.js`
- AI-генерация событий: `backend/src/services/ai.service.js`
- Планировщик и резолв: `backend/src/jobs/prediction-scheduler.js`
- События с цепи: `backend/src/index.js` (event polling)
- Деплой: `.github/workflows/deploy-autopilot.yml` (Render + Vercel deploy hooks)

## Язык

Код и коммиты — на английском. Комментарии и доки в репо могут быть на русском или английском.
