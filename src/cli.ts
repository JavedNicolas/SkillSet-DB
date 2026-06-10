import { Command } from 'commander';
import { indexCommand } from './commands/index-cmd.js';
import { listCommand } from './commands/list.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('skillsdb')
  .description('Skill-rules database for Claude Code — never forget a rule again')
  .version('0.1.0');

program
  .command('index')
  .description('Scan all skills and (re)build the rules database')
  .option('--force', 'Re-extract everything, ignoring content-hash cache')
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
