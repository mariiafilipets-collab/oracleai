# OracleAI Predict

Decentralized AI Prediction Platform on BNB Chain (local Hardhat for development).

## Architecture

```
contracts/     Solidity smart contracts (Hardhat)
backend/       Node.js + Express API server
frontend/      Next.js 14 web application
```

## Quick Start

### 1. Install dependencies

```bash
cd contracts && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

### 2. Start Hardhat node

```bash
cd contracts
npx hardhat node
```

This starts a local blockchain at `http://127.0.0.1:8545` with 20 test accounts (10000 ETH each).

### 3. Deploy contracts

In a new terminal:

```bash
cd contracts
npx hardhat run scripts/deploy.js --network localhost
```

Contract addresses are saved to `contracts/deployments/localhost.json`.

### 4. Start backend

```bash
cd backend
npm run dev
```

Backend runs at `http://localhost:3001`. Uses in-memory MongoDB (no external DB required).

### 5. Start frontend

```bash
cd frontend
npm run dev
```

Frontend runs at `http://localhost:3000`.

### 6. Connect wallet

1. Open MetaMask and add a custom network:
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency: `ETH`
2. Import the first Hardhat account private key:
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
3. Click "Connect" in the app

## Smart Contracts

| Contract | Description |
|----------|-------------|
| OAIToken | ERC20 token (1B supply), mintable, burnable |
| CheckIn | Daily check-in with tiered fees (Basic/Pro/Whale) |
| Points | On-chain points ledger with streaks |
| Referral | 6-level referral tree with fee distribution |
| PrizePool | Accumulates 50% of check-in fees for weekly prizes |
| Staking | Stake OAI for points boost (+20%) and referral boost (+15%) |
| Prediction | On-chain prediction events with voting |

## Fee Distribution

- 50% Prize Pool (weekly distribution to top 100)
- 25% Treasury
- 15% Referral rewards (6 levels: 10/5/3/2/1.5/1%)
- 10% Burn reserve

## Tier System

| Tier | Min Amount | Points Multiplier |
|------|-----------|-------------------|
| Basic | 0.001 ETH | 1x |
| Pro | 0.01 ETH | 3x |
| Whale | 0.05 ETH | 10x |

## AI Predictions

Set `AI_PROVIDER=openai` and `OPENAI_API_KEY=sk-...` in `backend/.env` for real AI predictions.
Default: mock predictions for local development.

## API Endpoints

- `GET /api/health` — Health check
- `GET /api/stats` — Platform statistics
- `GET /api/stats/contracts` — Deployed contract addresses
- `GET /api/predictions` — Active prediction events
- `POST /api/predictions/generate` — Generate new AI predictions
- `GET /api/leaderboard` — Weekly leaderboard (top 100)
- `GET /api/user/:address` — User profile with on-chain data
- `GET /api/user/:address/history` — Check-in history
