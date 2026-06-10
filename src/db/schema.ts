export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project','user','agents','plugin')),
  path TEXT NOT NULL UNIQUE,
  dir_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  description TEXT,
  frontmatter_json TEXT,
  shadowed_by INTEGER REFERENCES skills(id),
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending','llm','heuristic','failed')),
  indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  is_seed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES categories(slug),
  title TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  detail TEXT,
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  triggers TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_skill ON rules(skill_id);
CREATE INDEX IF NOT EXISTS idx_rules_category ON rules(category);
CREATE INDEX IF NOT EXISTS idx_files_skill ON files(skill_id);

CREATE VIRTUAL TABLE IF NOT EXISTS rules_fts USING fts5(
  title, rule_text, triggers, category,
  content='rules', content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS rules_ai AFTER INSERT ON rules BEGIN
  INSERT INTO rules_fts(rowid, title, rule_text, triggers, category)
  VALUES (new.id, new.title, new.rule_text, new.triggers, new.category);
END;

CREATE TRIGGER IF NOT EXISTS rules_ad AFTER DELETE ON rules BEGIN
  INSERT INTO rules_fts(rules_fts, rowid, title, rule_text, triggers, category)
  VALUES ('delete', old.id, old.title, old.rule_text, old.triggers, old.category);
END;

CREATE TRIGGER IF NOT EXISTS rules_au AFTER UPDATE ON rules BEGIN
  INSERT INTO rules_fts(rules_fts, rowid, title, rule_text, triggers, category)
  VALUES ('delete', old.id, old.title, old.rule_text, old.triggers, old.category);
  INSERT INTO rules_fts(rowid, title, rule_text, triggers, category)
  VALUES (new.id, new.title, new.rule_text, new.triggers, new.category);
END;
`;

export const CACHE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS extraction_cache (
  content_hash TEXT PRIMARY KEY,
  rules_json TEXT NOT NULL,
  model TEXT NOT NULL,
  taxonomy_version INTEGER NOT NULL,
  extracted_at TEXT NOT NULL
);
`;
