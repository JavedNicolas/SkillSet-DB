import { z } from 'zod';

export const LlmActivationSchema = z.object({
  decisions: z
    .array(
      z.object({
        skill: z.string().min(1),
        active: z.boolean(),
        reason: z.string().max(200),
      }),
    )
    .max(200),
});

export type LlmActivation = z.infer<typeof LlmActivationSchema>;
