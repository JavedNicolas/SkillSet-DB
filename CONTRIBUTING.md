# Contributing to SkillsDB

Thanks for your interest in improving SkillsDB. This guide covers local setup, the
development loop, and the conventions the project follows.

## Prerequisites

- **Node.js ≥ 20** (matches the `engines` field; the build targets Node 20).
- **The `claude` CLI is optional.** It powers LLM rule extraction and stack-relevance
  decisions. Without it, SkillsDB falls back to deterministic/heuristic extraction — the
  project still builds, tests, and runs, so you do not need it to contribute.

## Setup

```bash
git clone https://github.com/JavedNicolas/SkillDB.git
cd SkillsDB
npm install
```

`npm install` runs the `prepare` script (`tsup`), which produces `dist/cli.js` and
`dist/hook.js`. `better-sqlite3` is a native addon and is compiled during install.

## Development loop

```bash
npm run build       # bundle src/ -> dist/ with tsup
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
```

`prepublishOnly` runs `typecheck` + `test` + `build`, so all three must pass before a
release. Run them locally before opening a PR.

## Repository layout

| Path | Responsibility |
|---|---|
| `src/cli.ts` | Command dispatch (commander) — the source of truth for commands and flags |
| `src/hook.ts` | Hot-path hook entry: read event JSON, match, inject, exit |
| `src/commands/` | One file per CLI command |
| `src/detect/` | Stack detection and skill-activation decisions |
| `src/extract/` | Rule extraction (deterministic, LLM, heuristic) and caching |
| `src/match/` | FTS5 matching, formatting, session dedup, staleness |
| `src/db/` | SQLite schema, queries, migrations |
| `src/memory/` | Remembered rules and Claude-memory import |
| `src/mcp/server.ts` | MCP server and tool definitions |
| `test/` | Vitest suites mirroring the modules above |

## Conventions

- **TypeScript strict mode is non-negotiable.** Avoid `any`; use `unknown` and narrow.
- **Commit frequently** — one commit per logical working unit, and only when the repo
  builds clean (no errors/warnings) and tests pass.
- Commits are **unsigned** and carry **no `Co-Authored-By` footer**.
- Add or update a test alongside any behavior change.
- Update `CHANGELOG.md` under an `## [Unreleased]` heading for user-facing changes.
