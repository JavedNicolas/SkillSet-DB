import type { MatchedRule } from './matcher.js';

/**
 * Compact context block injected by the UserPromptSubmit hook.
 * Grouped by category, one line per rule, with a pointer to the MCP tools
 * for full rule text.
 */
export function formatRulesBlock(
  rules: MatchedRule[],
  opts: { stale?: boolean; heading?: 'prompt' | 'plan' } = {},
): string {
  if (rules.length === 0) return '';

  const byCategory = new Map<string, MatchedRule[]>();
  for (const rule of rules) {
    const list = byCategory.get(rule.category) ?? [];
    list.push(rule);
    byCategory.set(rule.category, list);
  }

  const lines: string[] = ['<skillsdb-rules>'];
  lines.push(
    opts.heading === 'plan'
      ? 'Rules from installed skills that apply to the approved plan — follow them during implementation:'
      : 'Rules from installed skills that apply to this task — follow them:',
  );
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
