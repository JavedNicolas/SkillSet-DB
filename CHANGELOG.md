# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1]

### Changed

- Unified every identifier under the `skillset-db` / Skillset DB name for consistency
  with the package: the CLI command (`skillset-db`), the MCP server and its tools
  (`skillset_db_*`), the index/config directory (`.skillset-db/`), the global extraction
  cache (`~/.skillset-db/`), the generated memory skills (`skillset-db-memory-<tech>`),
  and the injected rule tag (`<skillset-db-rules>`). Existing projects should re-run
  `skillset-db init` to migrate their local hook and `.mcp.json` registration.

## [0.1.0]

Initial release.

### Added

- **Rule extraction** from installed skills via three extractors, in order of preference:
  deterministic (frontmatter reference files), LLM (headless `claude` CLI, cached per
  content hash), and heuristic (headings / MUST / NEVER / ALWAYS).
- **Automatic injection** through Claude Code hooks at prompt time, plan approval, task
  creation, subagent spawn, and after compaction — matched offline with SQLite FTS5/BM25.
- **Stack-aware skill activation**: deterministic manifest detection plus an optional
  LLM relevance decision, so only skills relevant to a project's stack compete for
  injection. Manual `enable`/`disable`/`add`/`edit` overrides.
- **Remembered rules**: capture conversation rules via the `skillset_db_remember` MCP tool
  or the `remember` command, stored file-first as generated `skillset-db-memory-<tech>`
  skills. Import durable rules from Claude's project memory on `init`.
- **MCP server** exposing `skillset_db_match`, `skillset_db_rule_detail`,
  `skillset_db_rules_by_category`, `skillset_db_remember`, `skillset_db_forget`,
  `skillset_db_categories`, and `skillset_db_status`.
- **CLI**: `init`, `match`, `index`, `sync`, `watch`, `status`, `list`, `remember`,
  `forget`, `import-memory`, `add`, `edit`, `enable`, `disable`, `serve`, `clear`,
  `uninstall`.

[Unreleased]: https://github.com/JavedNicolas/SkillSet-DB/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/JavedNicolas/SkillSet-DB/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/JavedNicolas/SkillSet-DB/releases/tag/v0.1.0
