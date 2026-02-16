# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript backend for API and process control.
- `src/server.ts`: Express + WebSocket entrypoint and route wiring.
- `src/processManager.ts`: PTY/process lifecycle, logs, and history.
- `src/registry.ts`, `src/config.ts`, `src/storage.ts`, `src/historyStore.ts`: project/service persistence.
- `public/`: browser UI assets (`index.html`, `app.js`, `styles.css`).
- `tests/`: Playwright end-to-end specs (`*.spec.ts`).
- `scripts/`: local validation utilities (for example `smoke-api.mjs`).
- `dist/` and `.devrun/`: generated build/runtime artifacts (ignored by Git).

## Build, Test, and Development Commands
- `npm run dev`: start local dev server with watch mode (`tsx watch src/server.ts`).
- `npm run build`: compile TypeScript into `dist/`.
- `npm start`: run the compiled server (`node dist/server.js`).
- `npm run typecheck`: strict TypeScript checks without emitting files.
- `npm run smoke:api`: build, boot server, and run API smoke validation.
- `npm run test:e2e`: run Playwright terminal reliability tests.
- `npm run test:all`: run smoke + e2e as full validation.

## Coding Style & Naming Conventions
- Use TypeScript with strict typing; avoid `any` unless justified.
- Match existing style: 2-space indentation, double quotes, semicolons.
- Naming: `camelCase` for functions/variables, `PascalCase` for classes/types, descriptive filenames like `processManager.ts`.
- Keep route payloads explicit and stable; document intentional breaking changes in PRs.

## Testing Guidelines
- Add tests in `tests/` using `*.spec.ts` naming.
- Prefer assertions on behavior visible through APIs (`/api/state`, `/api/history`, `/api/logs`) when changing process/runtime logic.
- Run `npm run typecheck && npm run test:all` before opening a PR.

## Commit & Pull Request Guidelines
- Use concise imperative commit subjects (for example `Fix terminal reliability issues`).
- Keep commits focused; avoid mixing refactors with behavior changes.
- PRs should include: purpose/scope, local validation commands, API or UX impact, and screenshots/GIFs for UI changes.

## Security & Configuration Notes
- This project is local-first MVP tooling and currently has no auth layer.
- Do not expose it beyond localhost without adding authentication and access controls.
- Do not commit secrets in service commands, config, or captured logs.
