import type { Db } from '../db/database.js';
import {
  getMeta,
  listSkills,
  replaceStackFiles,
  setMeta,
  setSkillActivation,
  type SkillRow,
} from '../db/queries.js';
import type { SkillsetDbConfig } from '../config.js';
import { callClaudeJson, findClaudeBin } from '../extract/claudeCli.js';
import { homeDir, skillRoots } from '../paths.js';
import type { StackFileSnapshot } from '../db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import { detectStack, type StackProfile } from './stack.js';
import { ACTIVATION_RETRY_SUFFIX, ACTIVATION_SYSTEM_PROMPT, activationUserPrompt } from './prompts.js';
import { LlmActivationSchema } from './schema.js';
import crypto from 'node:crypto';

export interface ActivationDecision {
  skill: string;
  active: boolean;
  reason: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  scope: string;
}

export type LlmActivator = (profile: StackProfile, skills: SkillSummary[]) => Promise<ActivationDecision[] | null>;

export interface ApplyActivationOptions {
  noLlm?: boolean;
  llmActivate?: LlmActivator;
  onProgress?: (message: string) => void;
}

export interface ActivationSummary {
  active: number;
  inactive: number;
  method: 'llm' | 'fallback' | 'cached' | 'none';
}

interface AutoActivationCache {
  stackHash: string;
  skillsetHash: string;
  method: 'llm' | 'fallback';
  decisions: ActivationDecision[];
}

/** LLM activator backed by the headless claude CLI; null when unavailable. */
export function makeLlmActivator(config: SkillsetDbConfig): LlmActivator | null {
  const claudeBin = findClaudeBin();
  if (!claudeBin) return null;
  return async (profile, skills) => {
    const userPrompt = activationUserPrompt(profile, skills);
    let json = await callClaudeJson(claudeBin, config.extractionModel, ACTIVATION_SYSTEM_PROMPT, userPrompt);
    let parsed = safeParse(json);
    if (!parsed) {
      json = await callClaudeJson(
        claudeBin,
        config.extractionModel,
        ACTIVATION_SYSTEM_PROMPT,
        userPrompt + ACTIVATION_RETRY_SUFFIX,
      );
      parsed = safeParse(json);
    }
    if (!parsed) return null;
    const known = new Set(skills.map((s) => s.name));
    return parsed.decisions.filter((d) => known.has(d.skill));
  };
}

function safeParse(json: string | null): { decisions: ActivationDecision[] } | null {
  if (!json) return null;
  try {
    return LlmActivationSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * Conservative deterministic fallback: deactivate only skills that
 * demonstrably name a technology absent from the detected stack.
 */
export function fallbackActivation(profile: StackProfile, skills: SkillSummary[]): ActivationDecision[] {
  const TECH_LEXICON: Record<string, string[]> = {
    flutter: ['flutter', 'dart'],
    dart: ['dart', 'flutter'],
    bloc: ['bloc'],
    riverpod: ['riverpod'],
    react: ['react'],
    nextjs: ['nextjs', 'next'],
    vue: ['vue', 'nuxt'],
    svelte: ['svelte', 'sveltekit'],
    angular: ['angular'],
    express: ['express'],
    nestjs: ['nestjs'],
    supabase: ['supabase'],
    firebase: ['firebase'],
    postgres: ['postgres', 'postgresql', 'supabase'],
    django: ['django'],
    flask: ['flask'],
    fastapi: ['fastapi'],
    rails: ['rails', 'ruby'],
    laravel: ['laravel', 'php'],
    swift: ['swift', 'ios'],
    kotlin: ['kotlin', 'android'],
    golang: ['golang', 'go'],
    rust: ['rust'],
    python: ['python'],
    typescript: ['typescript'],
    javascript: ['javascript', 'node', 'nodejs'],
  };

  // competing libraries within one ecosystem: a skill naming one variant is
  // deactivated when the stack uses a DIFFERENT variant of the same group
  const EXCLUSIVE_GROUPS: string[][] = [
    ['bloc', 'riverpod', 'provider'],
    ['react', 'vue', 'svelte', 'angular'],
    ['express', 'nestjs', 'fastify'],
    ['django', 'flask', 'fastapi'],
    ['supabase', 'firebase'],
  ];

  const stackTags = new Set(
    [...profile.languages, ...profile.frameworks, ...profile.dependencies].map((t) => t.toLowerCase()),
  );
  // postgres is implied by supabase
  if (stackTags.has('supabase')) stackTags.add('postgres');

  return skills.map((skill) => {
    const text = `${skill.name} ${skill.description}`.toLowerCase();
    const mentioned: string[] = [];
    let satisfied = false;
    for (const [tech, tagSets] of Object.entries(TECH_LEXICON)) {
      if (!new RegExp(`\\b${tech}\\b`).test(text)) continue;
      mentioned.push(tech);
      if (tagSets.some((tag) => stackTags.has(tag))) satisfied = true;
    }
    if (mentioned.length === 0) {
      return { skill: skill.name, active: true, reason: 'stack-agnostic' };
    }
    // exclusive-group check: mentions a variant, stack uses a different one
    for (const group of EXCLUSIVE_GROUPS) {
      const mentionedInGroup = group.filter((g) => mentioned.includes(g));
      const stackInGroup = group.filter((g) => stackTags.has(g));
      if (
        mentionedInGroup.length > 0 &&
        stackInGroup.length > 0 &&
        !mentionedInGroup.some((g) => stackTags.has(g))
      ) {
        return {
          skill: skill.name,
          active: false,
          reason: `fallback: targets ${mentionedInGroup.join('/')} but stack uses ${stackInGroup.join('/')}`,
        };
      }
    }
    if (satisfied) {
      return { skill: skill.name, active: true, reason: 'matches stack' };
    }
    return {
      skill: skill.name,
      active: false,
      reason: `fallback: mentions ${mentioned.slice(0, 3).join(', ')} — not in detected stack`,
    };
  });
}

/**
 * Detect the stack, refresh the stack_files snapshot, compute or reuse the
 * auto-activation decisions, resolve precedence, and flip skills.active.
 *
 * Precedence: config.disabledSkills > config.enabledSkills > project scope >
 * auto decisions (when stack detected) > init selection > active.
 */
export async function applyActivation(
  db: Db,
  projectRoot: string,
  config: SkillsetDbConfig,
  options: ApplyActivationOptions = {},
): Promise<ActivationSummary> {
  const progress = options.onProgress ?? (() => {});
  const detection = detectStack(projectRoot);

  const writeSnapshot = db.transaction(() => {
    // manifests + skill ROOT directories: a directory's mtime changes when a
    // skill is added or removed, so new skills (e.g. a memory skill created
    // from another project) are picked up by the hook's staleness probe
    replaceStackFiles(db, [...detection.candidates, ...skillRootSnapshots(projectRoot)]);
    setMeta(db, 'stack_profile', JSON.stringify(detection.profile));
    setMeta(db, 'stack_hash', detection.hash);
  });
  writeSnapshot();

  const skills = listSkills(db);
  const skillsetHash = computeSkillsetHash(skills);
  const evaluable = skills
    .filter((s) => s.scope !== 'project' && s.shadowed_by === null)
    .map((s) => ({ name: s.name, description: s.description ?? '', scope: s.scope }));

  // auto layer: only when the project has a detectable stack
  let auto: Map<string, ActivationDecision> | null = null;
  let method: ActivationSummary['method'] = 'none';
  if (!detection.isEmpty && evaluable.length > 0) {
    const cached = readAutoCache(db);
    if (cached && cached.stackHash === detection.hash && cached.skillsetHash === skillsetHash) {
      auto = toMap(cached.decisions);
      method = 'cached';
    } else {
      let decisions: ActivationDecision[] | null = null;
      let decisionMethod: 'llm' | 'fallback' = 'fallback';
      if (!options.noLlm && options.llmActivate) {
        progress('Evaluating skill relevance for the detected stack...');
        decisions = await options.llmActivate(detection.profile, evaluable);
        if (decisions) decisionMethod = 'llm';
      }
      if (!decisions) decisions = fallbackActivation(detection.profile, evaluable);
      auto = toMap(decisions);
      method = decisionMethod;
      setMeta(
        db,
        'auto_activation',
        JSON.stringify({
          stackHash: detection.hash,
          skillsetHash,
          method: decisionMethod,
          decisions,
        } satisfies AutoActivationCache),
      );
    }
  }

  const initSelection = readInitSelection(db);
  const enabled = new Set(config.enabledSkills);
  const disabled = new Set(config.disabledSkills);

  let activeCount = 0;
  let inactiveCount = 0;
  const finalByName = new Map<string, { active: boolean; reason: string | null }>();

  const apply = db.transaction(() => {
    // pass 1: non-shadowed skills get their own decision
    for (const skill of skills) {
      if (skill.shadowed_by !== null) continue;
      const state = resolve(skill, auto, initSelection, enabled, disabled);
      finalByName.set(skill.name, state);
      if (state.active) activeCount++;
      else inactiveCount++;
      if (state.active !== Boolean(skill.active) || (state.reason ?? null) !== skill.inactive_reason) {
        setSkillActivation(db, skill.id, state.active, state.reason);
      }
    }
    // pass 2: shadowed losers mirror their winner (cosmetic; excluded from matching anyway)
    for (const skill of skills) {
      if (skill.shadowed_by === null) continue;
      const state = finalByName.get(skill.name) ?? { active: true, reason: null };
      if (state.active !== Boolean(skill.active)) {
        setSkillActivation(db, skill.id, state.active, state.reason);
      }
    }
    setMeta(db, 'activation_at', new Date().toISOString());
  });
  apply();

  if (inactiveCount > 0) progress(`Skill activation: ${activeCount} active, ${inactiveCount} inactive [${method}]`);
  return { active: activeCount, inactive: inactiveCount, method };
}

function resolve(
  skill: SkillRow,
  auto: Map<string, ActivationDecision> | null,
  initSelection: Set<string> | null,
  enabled: Set<string>,
  disabled: Set<string>,
): { active: boolean; reason: string | null } {
  if (enabled.has(skill.name)) return { active: true, reason: null }; // enabled wins ties with disabled
  if (disabled.has(skill.name)) return { active: false, reason: 'config: disabledSkills' };
  if (skill.scope === 'project') return { active: true, reason: null };
  if (auto) {
    const decision = auto.get(skill.name);
    if (decision) return { active: decision.active, reason: decision.active ? null : decision.reason };
    return { active: true, reason: null }; // no decision returned: fail open
  }
  if (initSelection) {
    return initSelection.has(skill.name)
      ? { active: true, reason: null }
      : { active: false, reason: 'init: not selected' };
  }
  return { active: true, reason: null };
}

function computeSkillsetHash(skills: SkillRow[]): string {
  const h = crypto.createHash('sha256');
  for (const s of [...skills].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope))) {
    h.update(s.name).update('\0').update(s.scope).update('\0');
    h.update(crypto.createHash('sha256').update(s.description ?? '').digest('hex')).update('\0');
  }
  return h.digest('hex');
}

function readAutoCache(db: Db): AutoActivationCache | null {
  try {
    const raw = getMeta(db, 'auto_activation');
    return raw ? (JSON.parse(raw) as AutoActivationCache) : null;
  } catch {
    return null;
  }
}

function readInitSelection(db: Db): Set<string> | null {
  try {
    const raw = getMeta(db, 'init_selection');
    if (!raw) return null;
    const names = JSON.parse(raw);
    return Array.isArray(names) ? new Set(names.filter((n) => typeof n === 'string')) : null;
  } catch {
    return null;
  }
}

function toMap(decisions: ActivationDecision[]): Map<string, ActivationDecision> {
  return new Map(decisions.map((d) => [d.skill, d]));
}

function skillRootSnapshots(projectRoot: string): StackFileSnapshot[] {
  const home = homeDir();
  const dirs = new Set<string>([
    path.join(projectRoot, '.claude', 'skills'),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.agents', 'skills'),
    ...skillRoots(projectRoot).map((r) => r.dir),
  ]);
  return [...dirs].map((dir) => {
    try {
      const st = fs.statSync(dir);
      return { path: dir, present: true, mtimeMs: Math.round(st.mtimeMs), size: st.size };
    } catch {
      return { path: dir, present: false, mtimeMs: null, size: null };
    }
  });
}
