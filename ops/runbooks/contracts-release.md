# Contracts Release Runbook

## Preconditions

- `contracts-release` workflow green on compile/test/static checks.
- Deployer wallet funded on target chain.
- `DEPLOYER_PRIVATE_KEY`, `BSC_TESTNET_RPC_URL`, `ETHERSCAN_API_KEY` configured in GitHub secrets.

## Release sequence

1. Run `contracts-release` workflow with:
   - `deploy_testnet = true`
   - `verify_on_bscscan = true` when constructor argument automation is ready.
2. Confirm `contracts/deployments/*.json` artifact update.
3. Smoke-check backend reads against new addresses.
4. Run UI smoke checks for check-in, vote, resolve path.

## Rollback

- Repoint backend/frontend deployment config to previous known-good `deployments/<network>.json`.
- Redeploy backend and frontend with previous addresses.
- Announce degraded mode if migration is required.

## Post-release checklist

- BscScan contract verification status.
- Event generation/resolution flow healthy.
- Referral/check-in/vote events observed in backend logs.
- Incident-free window (30-60 minutes).
