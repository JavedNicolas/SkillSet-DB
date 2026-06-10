# SkillsDB

**Never let Claude forget a rule again.**

When a project accumulates many Claude Code skills (global, project, plugins), the rules buried inside them stop being applied reliably — there are simply too many to keep in mind. SkillsDB makes rule-checking automatic instead of memory-dependent:

1. **Indexes every skill** available to your project (project `.claude/skills/`, user `~/.claude/skills/`, agent `~/.agents/skills/`, enabled plugins) into a local SQLite database of **atomic rules** with category, priority and trigger keywords.
2. **Injects the matching rules into every prompt** via a `UserPromptSubmit` hook: your request is categorized in ~50 ms (offline, FTS5/BM25 — no API call) and a compact checklist of the applicable rules is added to Claude's context. Guaranteed — Claude can't forget to check.
   In **plan mode**, a second hook fires when you approve the plan (`PostToolUse` on `ExitPlanMode`) and matches against the plan text itself — so work scoped *after* a vague prompt still gets its rules. Already initialized before this feature existed? Re-run `skillsdb init` to add the plan hook.
3. **Exposes MCP tools** (`skillsdb_match`, `skillsdb_rule_detail`, …) so Claude can query the rules database mid-task.
4. **Stays current**: content-hash sync re-extracts only changed skills; the hook detects stale files and refreshes in the background.

## Install

```bash
npm install -g skillsdb     # or npm link from a clone
cd your-project
skillsdb init
```

`init` creates `.skillsdb/` (self-gitignored), registers the hook in `.claude/settings.json` (append-only — existing hooks are never touched), registers the MCP server in `.mcp.json`, and runs the first index.

## Rule extraction

By default rules are extracted with the **headless claude CLI** (`claude -p`): each skill becomes 5–25 atomic imperative rules with categories, priorities (P1 critical → P4 info) and rich trigger keywords. Results are cached globally in `~/.skillsdb/` by content hash, so a skill is extracted **once ever**, across all your projects.

No claude CLI, or want zero token cost? `skillsdb init --no-llm` uses a deterministic heuristic extractor (headings, bullets, MUST/NEVER sentences). Re-running `skillsdb index` later upgrades heuristic skills to LLM quality.

Reference files with their own frontmatter (`title`, `impact`, `tags` — e.g. supabase-postgres-best-practices) are converted deterministically, with zero LLM calls.

## Commands

| Command | What it does |
|---|---|
| `skillsdb init` | Set up everything for the current project (`--no-hook`, `--no-mcp`, `--no-llm`) |
| `skillsdb match "<task>"` | Preview which rules a task description triggers |
| `skillsdb index` | Full rescan (`--force` ignores the cache) |
| `skillsdb sync` | Incremental update for changed skill files |
| `skillsdb watch` | Watch skill directories and sync on change |
| `skillsdb status` | Index health, counts per scope, staleness |
| `skillsdb list` | Skills, `--rules`, `--categories`, `--category <slug>` |
| `skillsdb uninstall` | Remove hook + MCP entries (`--purge` deletes the index) |

## How matching works

- Rules live in SQLite with an FTS5 index over title/text/triggers/category (porter stemming).
- Your prompt is tokenized and matched with BM25; trigger keywords get the highest column weight; rule priority amplifies ranking (P1 ×1.6 … P4 ×0.7).
- The top rules are packed into a ~800-token, max-15-rule checklist grouped by category. P1 rules are reserved first.
- Same skill at multiple scopes? Project wins over user, user over agents, agents over plugins; shadowed copies are indexed but never injected.

## Fail-open guarantee

The hook can never block your prompt: any error (missing DB, corrupt DB, malformed input, oversized prompt) exits silently with code 0. Extraction subprocesses run with hooks disabled and a recursion-guard env (`SKILLSDB_EXTRACTION=1`).

## Config

`.skillsdb/config.json`:

```json
{
  "tokenBudget": 800,
  "maxRules": 15,
  "extractionModel": "claude-opus-4-8",
  "noLlm": false
}
```
