# Render: RPC и события (Events)

## Ошибка в логах

Если в логах на Render видно:

- `JsonRpcProvider failed to detect network and cannot start up; retry in 1s`
- Много строк `[Events] Catch-up pruned range skipped ...`

**Причина:** бэкенд не может подключиться к RPC (BSC testnet). Часто публичные RPC блокируют или ограничивают запросы с IP датацентров (в т.ч. Render).

## Что сделать

### 1. Проверить переменные в Render

В **Dashboard → Service → Environment** должны быть заданы:

- `RPC_URL` — основной RPC (обязательно).
- `RPC_FALLBACK_URL` — запасной RPC (рекомендуется).

Пример для BSC Testnet:

```env
RPC_URL=https://bsc-testnet-rpc.publicnode.com
RPC_FALLBACK_URL=https://bsc-testnet.bnbchain.org
```

При старте бэкенд пробует оба; в логах будет строка вида  
`[Blockchain] RPC connected: https://...` — по ней видно, какой URL реально используется.

### 2. Если ошибка не исчезла

Попробуйте другой RPC (например, как основной):

- `https://bsc-testnet.bnbchain.org`
- `https://data-seed-prebsc-1-s1.bnbchain.org:8545`
- `https://bsc-testnet.drpc.org`

Для продакшена лучше взять выделенный RPC (GetBlock, QuickNode, Ankr и т.п.) — они обычно не режут трафик с облака.

### 3. Изменения в коде

- При старте проверяется доступность RPC; при неудаче выводится явная ошибка и подсказка по `RPC_URL` / `RPC_FALLBACK_URL`.
- Для BSC Testnet задаётся фиксированная сеть (chainId 97), чтобы не было лишних retry «detect network».
- Сетевые ошибки (недоступный RPC) больше не считаются «pruned» и не приводят к бесконечному потоку «Catch-up pruned range skipped».
