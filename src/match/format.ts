import type { MatchedRule } from './matcher.js';

/**
 * Compact context block injected by the UserPromptSubmit hook.
 * Grouped by category, one line per rule, with a pointer to the MCP tools
 * for full rule text.
 */
const HEADINGS = {
  prompt: 'Rules from installed skills that apply to this task — follow them:',
  plan: 'Rules from installed skills that apply to the approved plan — follow them during implementation:',
  tasks: 'Rules from installed skills that apply to your task list — follow them:',
  compact: 'Context was compacted — re-stating the SkillsDB rules that apply to the current work:',
  subagent: "Rules from this project's skills that apply to the session's current work — follow them:",
} as const;

export function formatRulesBlock(
  rules: MatchedRule[],
  opts: { stale?: boolean; heading?: keyof typeof HEADINGS } = {},
): string {
  if (rules.length === 0) return '';

  const byCategory = new Map<string, MatchedRule[]>();
  for (const rule of rules) {
    const list = byCategory.get(rule.category) ?? [];
    list.push(rule);
    byCategory.set(rule.category, list);
  }

  const lines: string[] = ['<skillsdb-rules>'];
  lines.push(HEADINGS[opts.heading ?? 'prompt']);
  for (const [category, list] of byCategory) {
    lines.push(`[${category}]`);
    for (const rule of list) {
      lines.push(`- R${rule.id} P${rule.priority} ${rule.ruleText} (${rule.skill})`);
    }
  }
  lines.push('Full text: mcp__skillsdb__skillsdb_rule_detail with the R-number.');
  if (opts.stale) {
    lines.push('Note: some skill files changed since last index; rules may be slightly stale (sync started).');
  }
  lines.push('</skillsdb-rules>');
  return lines.join('\n');
}

/**
 * Session-start awareness block: tells Claude the rules system exists before
 * any prompt is matched. Counts only — no rule bodies, a few dozen tokens.
 */
export function formatStatusBlock(counts: { rules: number; categories: number; skills: number }): string {
  if (counts.rules === 0) return '';
  return [
    '<skillsdb-status>',
    `SkillsDB is active on this project: ${counts.rules} rules from ${counts.skills} skills across ${counts.categories} categories.`,
    'Rules matching each task are injected automatically. For work not covered by injected rules, query mcp__skillsdb__skillsdb_match; full rule text via mcp__skillsdb__skillsdb_rule_detail.',
    '</skillsdb-status>',
  ].join('\n');
}

/** Human-readable output for `skillsdb match` on a terminal. */
export function formatRulesHuman(rules: MatchedRule[]): string {
  if (rules.length === 0) return 'No matching rules.';
  const lines: string[] = [];
  let lastCategory = '';
  for (const rule of rules) {
    if (rule.category !== lastCategory) {
      lines.push(`\n## ${rule.category}`);
      lastCategory = rule.category;
    }
    lines.push(`  R${rule.id} P${rule.priority} [${rule.skill}] ${rule.ruleText}`);
  }
  return lines.join('\n').trim();
}
