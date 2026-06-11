<div align="center">

# Skillset DB

### Turn every Claude Code skill into a searchable rule database — and auto-inject the rules that matter into each prompt

**~50 ms per injection · 0 API calls in the hot path · extraction cached per content hash**

[![npm version](https://img.shields.io/npm/v/skillset-db.svg)](https://www.npmjs.com/package/skillset-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-brightgreen.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-hooks_%2B_MCP-blueviolet.svg)](https://docs.claude.com/en/docs/claude-code)

</div>

Rule injection for Claude Code. Every skill you install becomes a database of atomic rules; the rules that apply to the current task are injected into context automatically — at prompt time, plan approval, task creation, subagent spawn, and after compaction.

> **This first version targets Claude Code only** — it builds on Claude Code's hooks and MCP integration. Support for more agents and editors is on the way.

## Why Skillset DB

Claude Code skills are loaded selectively: a skill's instructions only enter context when the model decides to invoke it. As projects accumulate skills (user-level, project-level, plugins), two failure modes appear:

- Rules buried in a skill the model did not invoke are never seen, so they are never applied.
- Rules seen early in a session are forgotten after the context grows or gets compacted.

Both failures are silent: the code works, but violates conventions you wrote down — wrong state-management pattern, missing RLS policy, hardcoded route strings. You catch it in review, then spend a correction round-trip.

Skillset DB removes the "model decides to look" step. It parses every skill available to a project into individual rules with categories, priorities, and trigger keywords, stores them in a local SQLite database, and matches the user's request against them on every prompt with FTS5/BM25 — lexical, offline, no model call. The matching rules are injected as a compact checklist the model cannot skip.

## Get Started

**Requirements:** Node.js ≥ 20. The `claude` CLI is optional — it enables LLM rule
extraction and stack-relevance decisions; without it, Skillset DB falls back to heuristic
extraction and a deterministic activation rule (everything still works, lower fidelity).

```
# 1. Install (package name skillset-db, command skillset-db)
npm install -g skillset-db

# 2. Initialize in your project
cd your-project
skillset-db init
```

`init` does four things:

1. Creates `.skillset-db/` (self-gitignored) with the SQLite rules database.
2. Indexes every skill visible to the project and extracts rules (see Extraction below).
3. Registers the hooks in `.claude/settings.json`. The merge is append-only: existing hooks from other tools are never modified, and re-running `init` never duplicates entries.
4. Registers the MCP server in `.mcp.json`.

Restart Claude Code in the project. Verify with:

```
skillset-db status
skillset-db match "write a supabase migration with RLS"
```

## What Gets Indexed

All skill scopes are merged, in precedence order:

| Scope | Location |
|---|---|
| project | `<project>/.claude/skills/` |
| user | `~/.claude/skills/` |
| agents | `~/.agents/skills/` (including `references/*.md`) |
| plugin | `~/.claude/plugins/cache/` (enabled plugins only) |

When the same skill name exists at several scopes, the higher scope wins; shadowed copies stay indexed but are excluded from matching.

## Stack-Aware Skill Activation

Global skills accumulate across projects and stacks — Flutter skills, Node skills, a BLoC skill for one app and a Riverpod skill for another. Indexing everything everywhere would let irrelevant rules compete for injection. Skillset DB activates skills per project:

1. **Stack detection** (deterministic, offline): known manifests are parsed for dependency names — `package.json`, `pubspec.yaml`, `go.mod`, `Cargo.toml`, `requirements.txt`, `pyproject.toml`, `composer.json`, `Gemfile`, `*.csproj`, `supabase/config.toml` — at the project root and one directory level down (monorepos produce a union profile). A capped file-extension census adds language evidence.
2. **Relevance decisions**: one headless claude call receives the profile and the skill list, and returns active/inactive per skill — this is what distinguishes a BLoC project from a Riverpod project when both are Flutter. The result is cached and re-computed only when the dependency set or the skill set changes. Without the claude CLI, a conservative deterministic fallback deactivates only skills that demonstrably name a technology the stack does not use (with exclusive-group handling for competing libraries).
3. **Lifecycle**: an inactive skill stays indexed but is excluded from all matching. When you add a dependency mid-project, the next hook fire notices the manifest change, re-detects the stack in the background, and newly relevant skills activate before your next prompt. Project-scope skills are always active.

On an **empty project** (no manifests, no source files), `skillset-db init` shows an interactive checklist to pick the active skills. The selection is a soft baseline: it is replaced by automatic detection as soon as the project gains a stack. `--no-interactive` (or a non-TTY) skips the prompt and keeps everything active.

Manual control always wins:

```
skillset-db add                         # interactive picker: activate inactive skills
skillset-db edit                        # interactive toggle list of all skills
skillset-db disable flutter-riverpod    # hard override, survives re-detection
skillset-db enable flutter-riverpod
skillset-db list                        # shows (inactive: <reason>) per skill
skillset-db status                      # shows the detected stack
```

`add` and `edit` write the same hard overrides as `enable`/`disable`. In `edit`, skills left in their current state stay governed by automatic detection — only toggles become overrides.

## Extraction

Skill bodies are freeform markdown, so turning them into atomic rules is the hard part. Skillset DB uses three extractors, in order of preference:

1. **Deterministic** — reference files that carry their own frontmatter (`title`, `impact`, `tags`) map directly to one rule each. Zero model calls.
2. **LLM** — the headless claude CLI (`claude -p`) reads each remaining skill and returns 5–25 atomic rules as validated JSON: one imperative sentence each, a category from the taxonomy, a priority (P1 critical to P4 informational), and 5–15 trigger keywords including synonyms, framework names, and file-extension hints. Results are cached in `~/.skillset-db/` keyed by content hash: a given skill version is extracted once, ever, across all projects on the machine.
3. **Heuristic** — when the claude CLI is absent or `--no-llm` is passed: headings, bullets, and MUST/NEVER/ALWAYS sentences, categorized by keyword overlap. Free and instant, lower fidelity. Heuristic skills are upgraded to LLM extraction automatically on the next `skillset-db index`.

Extraction subprocesses run with hooks disabled, an empty MCP config, and a guard environment variable, so indexing can never recursively trigger Skillset DB's own hooks.

## How Injection Works

```
user prompt ──► UserPromptSubmit hook ─┐
plan approved ─► PostToolUse hook ─────┤        ┌──────────────┐
task list ─────► PostToolUse hook ─────┼─ match │  skillset-db.db │ ─► rules block
subagent ──────► SubagentStart hook ───┤ (FTS5) │   (SQLite)   │    into context
compaction ────► SessionStart hook ────┘        └──────────────┘
```

Each hook fire is an isolated process: read the event JSON from stdin, open the database read-only, run one FTS query, print, exit. Measured at ~50 ms wall time on a 174-rule index.

Coverage by moment:

| Moment | Event | What is matched |
|---|---|---|
| Every user message | `UserPromptSubmit` | The prompt text |
| Plan approved (plan mode) | `PostToolUse: ExitPlanMode` | The full plan text |
| Claude writes its task list | `PostToolUse: TaskCreate\|TodoWrite` | Task subjects and todo contents |
| Subagent spawns | `SubagentStart` | The session's already-active rules (subagents do not see main-conversation context) |
| Session starts | `SessionStart` | None — injects a counts-only awareness block |
| Context compacted | `SessionStart (source: compact)` | Re-states the session's active rules, which compaction may have dropped |
| Session ends | `SessionEnd` | None — deletes the session's dedup record |

Plan, task, and subagent injections are deduplicated per session: a rule the model has already seen is not injected again. The dedup record lives in `.skillset-db/session-<id>.json` and is reset on `/clear` and removed at session end.

The injected block is compact by design — default budget 800 tokens, 15 rules, grouped by category, critical rules reserved first:

```
<skillset-db-rules>
Rules from installed skills that apply to this task — follow them:
[database]
- R23 P1 When you need a new migration SQL file, always create it with supabase migration new. (supabase)
- R11 P1 Enable RLS on every table in any exposed schema. (supabase)
[architecture]
- R4 P1 Features never import each other. Cross-feature data flows through core or DI only. (flutter-architecture)
Full text: mcp__skillset-db__skillset_db_rule_detail with the R-number.
</skillset-db-rules>
```

## Remembered Rules (conversation memory)

Rules you state in conversation ("never use `var` here", "always use our AppButton widget") usually live nowhere — they last one session. Skillset DB captures them through two failsafe paths:

1. **In conversation**: the `skillset_db_remember` MCP tool. The server instructions tell Claude to save lasting rules/corrections the moment you state them, with Claude supplying the category, priority, and trigger keywords itself — no extra model call. Always saved at global scope.
2. **From the terminal** (failsafe when the model did not catch it): `skillset-db remember "<rule>"`, with `--project` to scope it to the current project instead of globally, plus `--tech`, `--category`, `--priority`, `--triggers`, `--detail`.

Storage is file-first: each rule becomes a reference file inside a **generated skill** named `skillset-db-memory-<tech>` (flutter, react, typescript, ... — auto-detected from the project stack, or `general`), written to `~/.claude/skills/` (global) or `<project>/.claude/skills/` (project):

```
~/.claude/skills/skillset-db-memory-flutter/
  SKILL.md                      # human-readable mirror; loadable by Claude natively
  references/
    never-hardcode-hex-colors.md   # frontmatter: title, impact, tags, category
```

This layering is the point: the rule is simultaneously (a) indexed in the database and injected by the hooks like any other rule, (b) a real per-framework skill that Claude's native skill loading can use even without Skillset DB, and (c) subject to stack activation — the flutter memory skill deactivates in your JS backend. Other projects pick the rules up automatically through their own sync.

`skillset-db forget <R-number>` removes a remembered rule (file, index, and SKILL.md mirror); the matching MCP tool `skillset_db_forget` does the same from conversation. The R-number is shown everywhere a rule appears — injected blocks, `skillset-db list --rules`, `skillset-db match` — and running `skillset-db forget` with no argument lists every remembered rule with its number. Note that R-numbers are reassigned when a skill is re-extracted, so take them from current output.

Because the files are the source of truth, `skillset-db clear` followed by `skillset-db index` rebuilds the database with every remembered rule intact.

**Bootstrap from Claude's memory.** Rules you taught Claude in past sessions live in its per-project memory (`~/.claude/projects/<project>/memory/`). `skillset-db init` imports them automatically: a headless claude call reads the memory notes, keeps only durable instructions (biography and one-off context are dropped), and stores them as project-scoped remembered rules with the right tech bucket. Imported notes are tracked by content hash, so re-running never duplicates — and new memories accumulated later can be pulled in with `skillset-db import-memory`. Without the claude CLI, a deterministic fallback converts each note's description line into one rule.

## Matching

- One FTS5 virtual table over rule title, text, triggers, and category, with porter stemming.
- The request is tokenized (stopwords removed, capped at 24 terms) and ranked with BM25; the triggers column carries the highest weight.
- Priority scales the ranking: P1 ×1.6, P2 ×1.2, P3 ×1.0, P4 ×0.7.
- When FTS returns fewer than 3 hits (vague request), a fallback channel injects the high-priority rules of categories whose keyword maps overlap the request.
- Budget fill is greedy: P1 rules of matched categories first, then best-ranked until the token or count cap.

## Staying Current

Indexes go stale when skill files change. Three mechanisms reconcile, cheapest first:

1. **Per-fire staleness probe** — every hook fire stats the indexed files (sub-millisecond); on mismatch it appends a stale note and spawns a detached `skillset-db sync` behind a lockfile, so the next prompt sees fresh rules. This works with no daemon running.
2. **`skillset-db sync`** — manual incremental update; only skills whose content hash changed are re-extracted.
3. **`skillset-db watch`** — chokidar watcher over all skill roots with a 2 s debounce, for active skill-authoring sessions.

## CLI Reference

All commands operate on the current working directory's project.

### Setup

| Command | Description |
|---|---|
| `skillset-db init` | Set up everything for the project: index, hook, MCP server. Flags: `--no-hook`, `--no-mcp`, `--no-llm`, `--no-interactive`. |
| `skillset-db uninstall` | Remove the hook and MCP registration. `--purge` also deletes the `.skillset-db/` index directory. |

### Inspect

| Command | Description |
|---|---|
| `skillset-db match "<task>"` | Preview the rules a task description triggers. Flags: `--category <slug>`, `--limit <n>`. |
| `skillset-db status` | Index health, detected stack, counts per scope, and staleness. |
| `skillset-db list` | Skills with activation state. Flags: `--rules` (all rules grouped by category), `--categories` (taxonomy with counts), `--category <slug>`. |

### Index

| Command | Description |
|---|---|
| `skillset-db index` | Full rescan and (re)build of the rules database. `--force` ignores the content-hash cache; `--no-llm` skips LLM extraction. |
| `skillset-db sync` | Incremental update for changed skill files only. `--no-llm` skips LLM extraction. |
| `skillset-db watch` | Watch skill directories and sync on change. `--no-llm` skips LLM extraction. |
| `skillset-db clear` | Drop the project rules database (config and hooks kept); rebuild with `skillset-db index`. `--cache` also wipes the global cache in `~/.skillset-db`. |

### Activation

| Command | Description |
|---|---|
| `skillset-db add` | Interactive picker to activate skills currently inactive for this project. |
| `skillset-db edit` | Interactive toggle list of all skills. |
| `skillset-db enable <skill>` | Force a skill active for this project (hard override). |
| `skillset-db disable <skill>` | Force a skill inactive for this project (hard override). |

### Memory

| Command | Description |
|---|---|
| `skillset-db remember "<rule>"` | Save a conversation rule as a generated memory skill (global by default). Flags: `--project`, `--tech <tech>`, `--category <slug>`, `--priority <1-4>`, `--triggers <words>`, `--detail <text>`. |
| `skillset-db forget [R-number]` | Remove a remembered rule by its R-number. With no argument, lists every remembered rule. |
| `skillset-db import-memory` | Convert durable rules from Claude's project memory into remembered rules. `--no-llm` for deterministic conversion (one rule per note). |

### Server

| Command | Description |
|---|---|
| `skillset-db serve` | Start the MCP server (stdio). `--mcp` selects stdio mode explicitly and is the default. |

## MCP Tools

| Tool | Purpose |
|---|---|
| `skillset_db_match` | Match a task description against the rules database. For work in an area the injected rules do not cover. |
| `skillset_db_rule_detail` | Full text of one rule by its R-number, with the source file path so the original skill can be read. |
| `skillset_db_rules_by_category` | All rules of one category, ordered by priority. |
| `skillset_db_remember` | Persist a rule the user stated in conversation as a generated global memory skill. |
| `skillset_db_forget` | Remove a remembered rule by R-number. |
| `skillset_db_categories` | The category taxonomy with rule counts. |
| `skillset_db_status` | Index health and counts. |

## Configuration

`.skillset-db/config.json`:

```json
{
  "tokenBudget": 800,
  "maxRules": 15,
  "extractionModel": "claude-opus-4-8",
  "noLlm": false,
  "enabledSkills": [],
  "disabledSkills": []
}
```

- `tokenBudget` / `maxRules` — caps for each injected block.
- `enabledSkills` / `disabledSkills` — hard activation overrides, managed by `skillset-db enable|disable`.
- `extractionModel` — model used by the headless extraction calls. Switch to a smaller model to cut extraction cost; quality of trigger keywords drives matching quality, so prefer a capable model for skills you rely on.
- `noLlm` — permanent heuristic mode for this project.

There is no other configuration. The taxonomy ships with 16 seed categories (architecture, coding-style, ui-design, state-management, database, api-integration, auth-security, testing, performance, error-handling, git-workflow, devops-ci, docs, dependencies, tooling, general); the extractor may add project-specific ones, capped at 24 total.

## Failure Behavior

The hook fails open, always. Missing database, corrupt database, malformed event JSON, oversized prompt — every path exits 0 with no output, and your prompt goes through untouched. The hook entry also carries a 5 s timeout as a final backstop. Background syncs are lockfile-guarded and best-effort. The extraction cache and session records are optimizations; losing them costs a re-extraction or a duplicate injection, never an error.

## Troubleshooting

**No rules injected.** Run `skillset-db status` — if it reports no index, run `skillset-db init`. Check that `.claude/settings.json` contains the skillset-db hook entries (re-run `init` to repair; it is idempotent). Then test the matcher directly: `skillset-db match "your task"`.

**Rules look low-quality (fragments, table rows).** The skill was extracted heuristically. Confirm with `skillset-db list` (look for `[heuristic]`), then run `skillset-db index` with the claude CLI available to upgrade.

**Extraction is slow or expensive.** First index with `--no-llm`, upgrade later; or set a smaller `extractionModel`. Re-indexing is free for unchanged skills regardless — extraction is cached by content hash in `~/.skillset-db/`.

**A skill changed but old rules are injected.** The staleness probe triggers a background sync on the next hook fire; run `skillset-db sync` to force it immediately.

**Same skill at two scopes.** Intended: project > user > agents > plugin. `skillset-db list` marks the losers `(shadowed)`.

## License

MIT
