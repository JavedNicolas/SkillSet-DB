import type { ScannedReference, ScannedSkill } from '../scan/scanner.js';
import { SEED_CATEGORIES } from './taxonomy.js';
import type { ExtractedRule } from './types.js';

const MAX_RULES_PER_SKILL = 40;
const MAX_RULE_TEXT = 160;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'with', 'without',
  'for', 'from', 'into', 'onto', 'this', 'that', 'these', 'those', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'should', 'could', 'must', 'never', 'always', 'use', 'using', 'used', 'you',
  'your', 'it', 'its', 'of', 'to', 'in', 'on', 'at', 'by', 'as', 'not', 'no', 'all',
  'any', 'each', 'every', 'can', 'may', 'might', 'only', 'also', 'than', 'too', 'very',
  'via', 'per', 'etc', 'eg', 'ie', 'how', 'what', 'which', 'who', 'where', 'why',
]);

const IMPERATIVE_RE = /\b(must|never|always|don'?t|do not|avoid|require[ds]?|forbidden|prefer|ensure|should)\b/i;

/** Deterministic fast-path: a reference file with its own frontmatter is one rule. */
export function ruleFromReference(ref: ScannedReference, fallbackCategory: string): ExtractedRule | null {
  const fm = ref.frontmatter;
  const title = typeof fm.title === 'string' ? fm.title.trim() : '';
  if (!title) return null;

  const impact = String(fm.impact ?? '').toUpperCase();
  const priority = impact.includes('CRITICAL') ? 1 : impact.includes('HIGH') ? 2 : impact.includes('LOW') ? 4 : 3;
  const tags = String(fm.tags ?? '')
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const impactDescription = typeof fm.impactDescription === 'string' ? fm.impactDescription : '';

  return {
    title,
    ruleText: truncate(impactDescription ? `${title} — ${impactDescription}` : title, MAX_RULE_TEXT),
    category: bestCategory(`${title} ${tags.join(' ')} ${ref.body.slice(0, 600)}`, fallbackCategory),
    priority,
    triggers: uniq([...tags, ...keywords(title)]),
    detail: ref.body.trim().slice(0, 2000) || null,
    sourceFile: ref.path,
  };
}

/**
 * Heuristic extraction from a skill's markdown body: heading-scoped bullets
 * and sentences with imperative force (MUST/NEVER/ALWAYS/avoid/...).
 */
export function heuristicExtract(skill: ScannedSkill): ExtractedRule[] {
  const rules: ExtractedRule[] = [];
  const skillTriggers = uniq([...keywords(skill.name), ...keywords(skill.description).slice(0, 8)]);
  const fallbackCategory = bestCategory(`${skill.name} ${skill.description}`, 'general');

  let heading = '';
  let inCode = false;

  for (const rawLine of skill.body.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !line) continue;

    const h = line.match(/^#{2,4}\s+(.*)$/);
    if (h) {
      heading = h[1]?.trim() ?? '';
      continue;
    }

    const candidate = ruleCandidate(line);
    if (!candidate) continue;

    const context = `${skill.name} ${heading} ${candidate}`;
    rules.push({
      title: truncate(heading ? `${heading}: ${firstWords(candidate, 8)}` : firstWords(candidate, 10), 90),
      ruleText: truncate(candidate, MAX_RULE_TEXT),
      category: bestCategory(context, fallbackCategory),
      priority: /\b(never|must not|do not|don'?t|forbidden|critical)\b/i.test(candidate) ? 1 : 2,
      triggers: uniq([...skillTriggers, ...keywords(heading), ...keywords(candidate).slice(0, 6)]),
      detail: null,
      sourceFile: skill.path,
    });
    if (rules.length >= MAX_RULES_PER_SKILL) break;
  }
  return dedupeByText(rules);
}

/** A line qualifies as a rule if it's a bullet or sentence with imperative force. */
function ruleCandidate(line: string): string | null {
  // markdown table rows and blockquotes produce garbled fragments — skip them
  if (line.startsWith('|') || line.startsWith('>')) return null;
  const bullet = line.match(/^[-*]\s+(.*)$/);
  const bold = line.match(/^\*\*(?:key rule|rule|important|note)[:\s]*\*\*[:\s]*(.*)$/i);
  let text = bold?.[1] ?? bullet?.[1] ?? null;
  if (text === null) {
    // plain sentence: only keep strong imperative statements
    if (!IMPERATIVE_RE.test(line) || line.length < 20) return null;
    text = line;
  } else if (!IMPERATIVE_RE.test(text)) {
    return null;
  }
  text = stripMd(text);
  if (text.length < 12) return null;
  return text;
}

export function bestCategory(text: string, fallback: string): string {
  const lower = text.toLowerCase();
  let best = fallback;
  let bestScore = 0;
  for (const cat of SEED_CATEGORIES) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat.slug;
    }
  }
  return best;
}

export function keywords(text: string): string[] {
  return stripMd(text)
    .toLowerCase()
    .split(/[^a-z0-9.@_-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function stripMd(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

function firstWords(text: string, n: number): string {
  return text.split(/\s+/).slice(0, n).join(' ');
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

function dedupeByText(rules: ExtractedRule[]): ExtractedRule[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const key = r.ruleText.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
