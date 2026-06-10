/**
 * UserPromptSubmit hook entry — the product's hot path.
 *
 * Contract: NEVER block the user's prompt. On any error, print nothing and
 * exit 0. Matching logic lands in M2; until then this is a silent no-op.
 */
async function main(): Promise<void> {
  if (process.env.SKILLSDB_EXTRACTION === '1') return;
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
