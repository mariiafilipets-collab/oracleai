# Security Policy

## Supported deployment channels

- `dev`
- `staging`
- `prod`

## Reporting vulnerabilities

If you discover a security issue, do not create a public issue with exploit details.

Use private disclosure to the project owner and include:

- affected component (`contracts`, `backend`, `frontend`, CI/CD),
- severity estimate,
- reproduction steps,
- mitigation suggestion.

## Baseline controls

- Secret scanning enabled.
- Dependency updates reviewed before production.
- Production deploys only from protected branches and environment secrets.
