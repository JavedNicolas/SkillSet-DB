import type { StackProfile } from './stack.js';

export const ACTIVATION_SYSTEM_PROMPT = `You decide which Claude Code skills are relevant to a software project, given the project's detected technology stack.

Output ONLY a JSON object, no prose, no markdown fences:
{"decisions": [{"skill": "<name>", "active": true|false, "reason": "<short>"}, ...]}

Rules:
- One decision per skill in the input list, using the exact skill name.
- active=true when the skill's subject matter applies to this project's stack, OR when the skill is stack-agnostic (git workflow, documentation, general coding practices, testing methodology, tooling for the agent itself).
- active=false ONLY when the skill clearly targets a technology this project does not use. Examples: a Flutter skill in a pure JavaScript backend; a Riverpod skill when the project uses flutter_bloc and not riverpod; a Django skill in a Go project.
- Competing libraries in the same ecosystem deactivate each other: if the dependencies show flutter_bloc but not riverpod, a riverpod-specific skill is inactive.
- When uncertain, prefer active=true. Deactivating a relevant skill is worse than keeping an irrelevant one.
- Keep reasons under 15 words.`;

export function activationUserPrompt(
  profile: StackProfile,
  skills: { name: string; description: string; scope: string }[],
): string {
  const profileText = [
    `Languages: ${profile.languages.join(', ') || 'none detected'}`,
    `Frameworks: ${profile.frameworks.join(', ') || 'none detected'}`,
    `Dependencies: ${profile.dependencies.slice(0, 60).join(', ') || 'none'}`,
    `Manifests: ${profile.manifests.join(', ') || 'none'}`,
  ].join('\n');

  const skillsText = skills
    .map((s) => `- ${s.name} [${s.scope}]: ${s.description.slice(0, 200)}`)
    .join('\n');

  return `Project stack:\n${profileText}\n\nSkills to evaluate:\n${skillsText}`;
}

export const ACTIVATION_RETRY_SUFFIX =
  '\n\nYour previous reply was not valid JSON for the required schema. Reply again with ONLY the JSON object.';
