import { Command } from 'commander';
import { indexCommand } from './commands/index-cmd.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { matchCommand } from './commands/match.js';
import { statusCommand } from './commands/status.js';

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

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
