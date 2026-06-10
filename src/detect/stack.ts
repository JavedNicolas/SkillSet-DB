import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { StackFileSnapshot } from '../db/queries.js';
import { censusProject } from './census.js';
import { MANIFEST_SPECS, parseCsproj, type Evidence, type ManifestSpec } from './manifests.js';

export interface StackProfile {
  languages: string[];
  frameworks: string[];
  /** Dependency names only (no versions — version bumps must not churn the hash). */
  dependencies: string[];
  /** Project-root-relative manifest paths that were found. */
  manifests: string[];
  /** Top extensions from the census. */
  extensions: Record<string, number>;
}

export interface StackDetection {
  profile: StackProfile;
  hash: string;
  /** Every probed candidate, present or not — becomes the stack_files snapshot. */
  candidates: StackFileSnapshot[];
  /** No manifests and almost no recognized source files. */
  isEmpty: boolean;
}

const MAX_SUBDIRS = 30;
const MAX_CANDIDATES = 60;
const MAX_DEPS = 80;
const EMPTY_SOURCE_THRESHOLD = 5;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'target', 'vendor', 'out', 'coverage', '.dart_tool',
]);

export function detectStack(projectRoot: string): StackDetection {
  const candidates: StackFileSnapshot[] = [];
  const found: { spec: ManifestSpec; absPath: string; relPath: string }[] = [];

  const probe = (relPath: string, spec: ManifestSpec): void => {
    if (candidates.length >= MAX_CANDIDATES) return;
    const absPath = path.join(projectRoot, relPath);
    try {
      const st = fs.statSync(absPath);
      candidates.push({ path: absPath, present: true, mtimeMs: Math.round(st.mtimeMs), size: st.size });
      found.push({ spec, absPath, relPath });
    } catch {
      candidates.push({ path: absPath, present: false, mtimeMs: null, size: null });
    }
  };

  // root manifests
  for (const spec of MANIFEST_SPECS) probe(spec.file, spec);
  // root .csproj
  for (const name of safeReaddir(projectRoot)) {
    if (name.endsWith('.csproj')) probe(name, { file: name, language: 'csharp', parse: parseCsproj });
  }
  // depth-1 subdirs (monorepos: backend/package.json, mobile/pubspec.yaml, ...)
  const subdirs = safeReaddir(projectRoot)
    .filter((n) => !n.startsWith('.') && !SKIP_DIRS.has(n) && isDir(path.join(projectRoot, n)))
    .slice(0, MAX_SUBDIRS);
  for (const sub of subdirs) {
    for (const spec of MANIFEST_SPECS) {
      if (spec.file.includes('/')) continue; // nested specs are root-only
      probe(path.join(sub, spec.file), spec);
    }
  }

  // merge evidence
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const dependencies = new Set<string>();
  const manifests: string[] = [];
  for (const { spec, absPath, relPath } of found) {
    manifests.push(relPath);
    let ev: Evidence;
    try {
      ev = spec.parse(fs.readFileSync(absPath, 'utf8'));
    } catch {
      ev = { languages: spec.language ? [spec.language] : [], frameworks: [], dependencies: [] };
    }
    ev.languages.forEach((l) => languages.add(l));
    ev.frameworks.forEach((f) => frameworks.add(f));
    ev.dependencies.forEach((d) => dependencies.add(d));
  }

  const census = censusProject(projectRoot);
  census.languages.forEach((l) => languages.add(l));

  const profile: StackProfile = {
    languages: [...languages].sort(),
    frameworks: [...frameworks].sort(),
    dependencies: [...dependencies].sort().slice(0, MAX_DEPS),
    manifests: manifests.sort(),
    extensions: topExtensions(census.extensions, 10),
  };

  return {
    profile,
    hash: stackHash(profile),
    candidates,
    isEmpty: manifests.length === 0 && census.totalRecognized < EMPTY_SOURCE_THRESHOLD,
  };
}

export function stackHash(profile: StackProfile): string {
  const canonical = JSON.stringify({
    languages: profile.languages,
    frameworks: profile.frameworks,
    dependencies: profile.dependencies,
    manifests: profile.manifests,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function topExtensions(extensions: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(extensions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
