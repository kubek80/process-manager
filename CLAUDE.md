# Process Manager

Company processes (request a GCP project, onboard to Akamai…) as JSON files, read as a swim-lane map and a checklist. React + Vite frontend, Go backend with Postgres for sign-in, rights and feedback. Start with `README.md`; server details are in `docs/backend.md`.

## Always

- **Finish every task that changes code by running the `update-docs` skill**, before the final summary and before committing. The in-app Guide (`src/components/GuidePage.tsx`) is the main documentation and must match the code.
- Run the tests that cover what you changed, and `npm run test:all` before saying a change is done. Add tests with every feature and every bug fix.
- Process content is edited with the `edit-process` skill, the lists with `manage-catalog`.

## Commands

| | |
| --- | --- |
| `npm run dev` | Postgres (docker compose), Go server, Vite. Set `PM_PG=postgres://pm:pm@localhost:5432` to use an existing Postgres instead of Docker. |
| `npm run test:all` | typecheck, validate, Vitest, Go tests, Playwright |
| `npm test` · `npm run test:server` · `npm run test:e2e` | one level at a time |
| `npm run validate` | process files and catalog |
| `npm run prompt` | regenerate `docs/llm-prompt.md` |

## Conventions

- Processes and lists live in the repository (`processes/`, `catalog/`); the deployed app never writes them. Feedback lives in Postgres.
- Rights are enforced in the server (`server/internal/httpapi`); the frontend only hides controls.
- Text shown to users is written for business analysts: plain words, no implementation terms.
- Go: `gofmt` and `go vet` clean. Database tests use a real Postgres through `feedbacktest.NewStore`.
