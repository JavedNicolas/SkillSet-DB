import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { skillRoots, type SkillScope } from '../paths.js';

export interface ScannedFile {
  path: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
}

export interface ScannedSkill {
  name: string;
  scope: SkillScope;
  /** Path of the main SKILL.md / skill.md. */
  path: string;
  dirPath: string;
  /** Combined hash of every file belonging to the skill. */
  contentHash: string;
  description: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Main file + reference files. */
  files: ScannedFile[];
  /** reference .md files (path -> parsed) excluding the main file. */
  references: ScannedReference[];
}

export interface ScannedReference {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

const MAIN_FILENAMES = ['SKILL.md', 'skill.md'];

/** Scan every skill root for a project and return all skills found. */
export function scanSkills(projectRoot: string): ScannedSkill[] {
  const skills: ScannedSkill[] = [];
  for (const root of skillRoots(projectRoot)) {
    for (const entry of safeReaddir(root.dir)) {
      const dirPath = path.join(root.dir, entry);
      if (!safeIsDir(dirPath)) continue;
      const skill = scanSkillDir(dirPath, root.scope);
      if (skill) skills.push(skill);
    }
  }
  return skills;
}

export function scanSkillDir(dirPath: string, scope: SkillScope): ScannedSkill | null {
  const mainName = MAIN_FILENAMES.find((f) => safeIsFile(path.join(dirPath, f)));
  if (!mainName) return null;
  const mainPath = path.join(dirPath, mainName);

  let raw: string;
  try {
    raw = fs.readFileSync(mainPath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseFrontmatter(raw);
  const files: ScannedFile[] = [statFile(mainPath, raw)];
  const references: ScannedReference[] = [];

  for (const refPath of referenceFiles(dirPath)) {
    try {
      const refRaw = fs.readFileSync(refPath, 'utf8');
      const refParsed = parseFrontmatter(refRaw);
      files.push(statFile(refPath, refRaw));
      references.push({ path: refPath, frontmatter: refParsed.data, body: refParsed.content });
    } catch {
      // unreadable reference file: skip it, keep the skill
    }
  }

  const name =
    typeof parsed.data.name === 'string' && parsed.data.name.trim()
      ? parsed.data.name.trim()
      : path.basename(dirPath);

  return {
    name,
    scope,
    path: mainPath,
    dirPath,
    contentHash: combinedHash(files),
    description: typeof parsed.data.description === 'string' ? parsed.data.description : '',
    frontmatter: parsed.data,
    body: parsed.content,
    files,
    references,
  };
}

/** All .md files under <dir>/references/ (one level, skip _-prefixed meta files). */
function referenceFiles(dirPath: string): string[] {
  const refDir = path.join(dirPath, 'references');
  return safeReaddir(refDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => path.join(refDir, f))
    .filter(safeIsFile)
    .sort();
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  try {
    const parsed = matter(raw);
    return { data: parsed.data ?? {}, content: parsed.content ?? '' };
  } catch {
    // broken YAML: treat the whole file as body
    return { data: {}, content: raw };
  }
}

function statFile(filePath: string, raw: string): ScannedFile {
  const st = fs.statSync(filePath);
  return {
    path: filePath,
    contentHash: sha256(raw),
    mtimeMs: Math.round(st.mtimeMs),
    size: st.size,
  };
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function combinedHash(files: ScannedFile[]): string {
  const h = crypto.createHash('sha256');
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path).update('\0').update(f.contentHash).update('\0');
  }
  return h.digest('hex');
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
