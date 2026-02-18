# Repository Guidelines

## One-line vision
Devrun is the simplest local control center for running and observing multiple dev projects and their long-running services, with AI-ready access to what is happening.

## The problem
Developers working across 5-10 projects constantly context-switch between terminals, scripts, and tabs to start services, inspect logs, and recover from failures.
This is noisy, slow, and hard to hand off to AI tooling.
The second problem is that AIs and humans can't share one terminal and that it's hard for the AI to inspect the terminal to understand the project, especially when debugging.

## Project Structure & Module Organization
- `src/app/`: Next.js App Router entry files (`layout.tsx`, `page.tsx`).
- `src/components/`, `src/hooks/`, `src/lib/`, `src/stores/`, `src/types/`: shared UI modules.
- `src/backend/`: API/runtime process control (`server.ts`, `processManager.ts`, persistence/config modules).
- `src/styles/main.css`: global/base styling and theme tokens.
- `tests/`: Playwright end-to-end specs (`*.spec.ts`).
- `scripts/`: local validation utilities (for example `smoke-api.mjs`).
- `dist/` and `.devrun/`: generated build/runtime artifacts (ignored by Git).

## Build, Test, and Development Commands
- `npm run dev`: start local dev server with watch mode (`tsx watch src/backend/server.ts`).
- `npm run build`: build Next.js app and compile server TypeScript (`dist/`).
- `npm start`: run the compiled server (`node dist/server.js`).
- `npm run typecheck`: strict TypeScript checks without emitting files.
- `npm run smoke:api`: build, boot server, and run API smoke validation.
- `npm run test:e2e`: run Playwright terminal reliability tests.
- `npm run test:all`: run smoke + e2e as full validation.

## AI Operator Contract
- Use `GET /api/capabilities` first when endpoint constraints are unknown.
- Prefer path-first process control (`projectPath` or `cwd`), not ID-first lookups.
- Omit `serviceName` to use project `defaultService` unless a non-default service is intended.
- Use `GET /api/history` for low-noise lifecycle/command timeline.
- Use `GET /api/logs` for verbose output; pass `runId` when run-specific debugging is needed.
- Use `GET /api/state` when project/service discovery or runtime status metadata is needed.

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
