export interface ExtractedRule {
  title: string;
  /** One imperative sentence, <=160 chars. */
  ruleText: string;
  category: string;
  /** 1 critical .. 4 info. */
  priority: number;
  /** Keywords, synonyms, framework names, file-extension hints. */
  triggers: string[];
  detail: string | null;
  sourceFile: string;
}

export interface ExtractionResult {
  rules: ExtractedRule[];
  /** 'llm' | 'heuristic' */
  method: 'llm' | 'heuristic';
}
