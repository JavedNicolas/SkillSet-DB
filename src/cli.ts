import { Command } from 'commander';
import { indexCommand } from './commands/index-cmd.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { matchCommand } from './commands/match.js';
import { statusCommand } from './commands/status.js';
import { uninstallCommand } from './commands/uninstall.js';

const program = new Command();

program
  .name('skillsdb')
  .description('Skill-rules database for Claude Code — never forget a rule again')
  .version('0.1.0');

program
  .command('init')
  .description('Set up SkillsDB for this project: index, hook, MCP server')
  .option('--no-hook', 'Do not register the UserPromptSubmit hook')
  .option('--no-mcp', 'Do not register the MCP server')
  .option('--no-llm', 'Skip LLM extraction (heuristic only)')
  .option('--no-interactive', 'Never prompt; all skills stay active when no stack is detected')
  .action(async (opts) => {
    await initCommand(process.cwd(), opts);
  });

program
  .command('match <text>')
  .description('Show the rules SkillsDB would inject for a task description')
  .option('--category <slug>', 'Restrict matching to one category')
  .option('--limit <n>', 'Max rules to return')
  .action((text, opts) => {
    matchCommand(process.cwd(), text, opts);
  });

program
  .command('index')
  .description('Scan all skills and (re)build the rules database')
  .option('--force', 'Re-extract everything, ignoring content-hash cache')
  .option('--no-llm', 'Skip LLM extraction (heuristic only)')
  .action(async (opts) => {
    await indexCommand(process.cwd(), opts);
  });

program
  .command('serve')
  .description('Start the SkillsDB MCP server')
  .option('--mcp', 'stdio MCP mode (default)')
  .action(async () => {
    const { serveMcp } = await import('./mcp/server.js');
    await serveMcp(process.cwd());
  });

program
  .command('sync')
  .description('Incrementally update the index for changed skill files')
  .option('--no-llm', 'Skip LLM extraction (heuristic only)')
  .action(async (opts) => {
    await indexCommand(process.cwd(), opts);
  });

program
  .command('status')
  .description('Show index health and counts per scope')
  .action(() => {
    statusCommand(process.cwd());
  });

program
  .command('list')
  .description('List skills, or rules with --rules / --category')
  .option('--categories', 'Show category taxonomy with rule counts')
  .option('--rules', 'List all rules grouped by category')
  .option('--category <slug>', 'List rules of one category')
  .action((opts) => {
    listCommand(process.cwd(), opts);
  });

program
  .command('watch')
  .description('Watch skill directories and sync the index on change')
  .option('--no-llm', 'Skip LLM extraction (heuristic only)')
  .action(async (opts) => {
    const { watchCommand } = await import('./commands/watch.js');
    await watchCommand(process.cwd(), opts);
  });

program
  .command('remember <rule>')
  .description('Save a conversation rule as a generated memory skill (global by default)')
  .option('--project', 'Save into this project instead of globally')
  .option('--tech <tech>', 'Framework/language bucket (flutter, react, typescript...); default: detected stack')
  .option('--category <slug>', 'Rule category')
  .option('--priority <1-4>', 'Priority: 1 critical .. 4 info (default 2)')
  .option('--triggers <words>', 'Comma/space separated trigger keywords')
  .option('--detail <text>', 'Longer explanation stored with the rule')
  .action(async (rule, opts) => {
    const { rememberCommand } = await import('./commands/remember.js');
    await rememberCommand(process.cwd(), rule, opts);
  });

program
  .command('import-memory')
  .description("Convert rules from Claude's project memory into remembered rules")
  .option('--no-llm', 'Deterministic conversion only (one rule per memory note)')
  .action(async (opts) => {
    const { importMemoryCommand } = await import('./commands/remember.js');
    await importMemoryCommand(process.cwd(), opts);
  });

program
  .command('forget [ruleId]')
  .description('Remove a remembered rule by its R-number (no argument: list remembered rules)')
  .action(async (ruleId) => {
    const { forgetCommand } = await import('./commands/remember.js');
    await forgetCommand(process.cwd(), ruleId);
  });

program
  .command('clear')
  .description('Drop the project rules database (config and hooks kept); rebuild with skillsdb index')
  .option('--cache', 'Also clear the global extraction cache in ~/.skillsdb')
  .action(async (opts) => {
    const { clearCommand } = await import('./commands/clear.js');
    clearCommand(process.cwd(), opts);
  });

program
  .command('add')
  .description('Interactively activate skills that are currently inactive for this project')
  .action(async () => {
    const { addCommand } = await import('./commands/activate.js');
    await addCommand(process.cwd());
  });

program
  .command('edit')
  .description('Interactively toggle which skills are active for this project')
  .action(async () => {
    const { editCommand } = await import('./commands/activate.js');
    await editCommand(process.cwd());
  });

program
  .command('enable <skill>')
  .description('Force a skill active for this project (hard override)')
  .action(async (skill) => {
    const { setSkillOverride } = await import('./commands/activate.js');
    await setSkillOverride(process.cwd(), skill, true);
  });

program
  .command('disable <skill>')
  .description('Force a skill inactive for this project (hard override)')
  .action(async (skill) => {
    const { setSkillOverride } = await import('./commands/activate.js');
    await setSkillOverride(process.cwd(), skill, false);
  });

program
  .command('uninstall')
  .description('Remove the hook and MCP registration from this project')
  .option('--purge', 'Also delete the .skillsdb/ index directory')
  .action((opts) => {
    uninstallCommand(process.cwd(), opts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
