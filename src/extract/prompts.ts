import type { Db } from '../db/database.js';

export function extractionSystemPrompt(db: Db): string {
  const categories = db.prepare('SELECT slug, label FROM categories ORDER BY slug').all() as {
    slug: string;
    label: string;
  }[];
  const taxonomy = categories.map((c) => `${c.slug} (${c.label})`).join(', ');

  return `You extract actionable rules from a Claude Code skill file so an AI assistant can be reminded of them before each task.

Output ONLY a JSON object, no prose, no markdown fences, matching exactly:
{
  "rules": [
    {
      "title": "short rule name",
      "rule_text": "ONE imperative sentence, max 160 chars, self-contained",
      "category": "one of the taxonomy slugs",
      "priority": 1,
      "triggers": ["keyword", ...],
      "detail": "optional short elaboration or correct/incorrect example, max 2000 chars"
    }
  ],
  "new_categories": []
}

Categories (use these slugs): ${taxonomy}

Guidelines:
- Extract 5-25 atomic rules. Each rule = one enforceable instruction, not a topic summary.
- rule_text must be imperative and self-contained ("Never X", "Always Y when Z").
- priority: 1 = critical/correctness/destructive-if-violated, 2 = strong convention, 3 = recommendation, 4 = informational.
- triggers: 5-15 lowercase keywords that a user's task description would contain when this rule applies. Include synonyms, verbs, framework/library names, and file-extension hints (e.g. "bloc cubit freezed .dart widget"). Always include the skill's domain words.
- Skip marketing text, installation steps, and tables of contents.
- Only add to new_categories when no existing slug fits at all (rare): {"slug":"kebab-case","label":"Label","keywords":["k1","k2"]}.`;
}

export function extractionUserPrompt(name: string, description: string, content: string): string {
  return `Skill name: ${name}\nSkill description: ${description}\n\nSkill content:\n\n${content}`;
}

export const RETRY_SUFFIX =
  '\n\nYour previous reply was not valid JSON for the required schema. Reply again with ONLY the JSON object, no fences, no commentary.';
