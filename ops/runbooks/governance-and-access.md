# Governance and Access Model

This repository is configured for an AI-operated delivery model with human ownership.

## Required repository settings (GitHub UI)

1. Branch protection for `oracleai-fullstack` and `main`:
   - Require pull request before merge.
   - Require status checks to pass.
   - Require linear history.
   - Require signed commits (optional if your team policy allows).
2. Environments:
   - `dev`, `staging`, `prod`.
   - Add required reviewers for `prod`.
3. Secrets and variables:
   - Store all runtime and deploy secrets in environment-scoped secrets.
4. Service accounts:
   - Use bot/service users for automation.
   - Grant minimum repository scopes required for CI/CD and posting.

## Enforced checks

- `ci-core` workflow for contracts/backend/frontend validation.
- `contracts-release` workflow for contract release lane.
- `deploy-autopilot` workflow for runtime deployments.

## Audit requirements

- Every automated run must keep:
  - actor (human/bot),
  - workflow run URL,
  - commit SHA,
  - deployment target,
  - rollback action when applicable.

## Safety rules

- Never store plaintext secrets in source files.
- Never bypass quality checks for production deployments.
- Any failed prod health check must trigger rollback workflow.
