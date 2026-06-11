# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Remembered rules**: capture conversation rules via the `skillsdb_remember` MCP tool
  or the `remember` command, stored file-first as generated `skillsdb-memory-<tech>`
  skills. Import durable rules from Claude's project memory on `init`.
- **MCP server** exposing `skillsdb_match`, `skillsdb_rule_detail`,
  `skillsdb_rules_by_category`, `skillsdb_remember`, `skillsdb_forget`,
  `skillsdb_categories`, and `skillsdb_status`.
- **CLI**: `init`, `match`, `index`, `sync`, `watch`, `status`, `list`, `remember`,
  `forget`, `import-memory`, `add`, `edit`, `enable`, `disable`, `serve`, `clear`,
  `uninstall`.

[Unreleased]: https://github.com/JavedNicolas/SkillsDB/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JavedNicolas/SkillsDB/releases/tag/v0.1.0
