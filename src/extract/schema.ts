import { z } from 'zod';

export const LlmRuleSchema = z.object({
  title: z.string().min(1).max(160),
  rule_text: z.string().min(1).max(400),
  category: z.string().min(1).max(40),
  priority: z.coerce.number().int().min(1).max(4),
  triggers: z.array(z.string().min(1)).min(1).max(30),
  detail: z.string().max(2000).nullish(),
});

export const LlmCategorySchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(60),
  keywords: z.array(z.string().min(1)).max(20).default([]),
});

export const LlmExtractionSchema = z.object({
  rules: z.array(LlmRuleSchema).max(60),
  new_categories: z.array(LlmCategorySchema).max(4).default([]),
});

export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;
