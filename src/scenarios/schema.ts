import { z } from 'zod';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ScenarioSchema = z.strictObject({
  id: z
    .string()
    .regex(KEBAB_CASE, 'id must be kebab-case (lowercase letters, digits, hyphens)'),
  prompt: z.string().min(1),
  expected_tool: z.string().min(1),
  expected_args: z.record(z.string(), z.unknown()).optional(),
  max_calls: z.number().int().positive().default(1),
});

export const ServerSpecSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

export const ScenarioSuiteSchema = z
  .strictObject({
    suite: z.string().min(1),
    description: z.string().optional(),
    server: ServerSpecSchema,
    scenarios: z
      .array(ScenarioSchema)
      .min(1, 'a suite needs at least one scenario'),
  })
  .superRefine((suite, ctx) => {
    const seen = new Set<string>();
    for (const [i, s] of suite.scenarios.entries()) {
      if (seen.has(s.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenarios', i, 'id'],
          message: `duplicate scenario id "${s.id}"`,
        });
      }
      seen.add(s.id);
    }
  });

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ServerSpec = z.infer<typeof ServerSpecSchema>;
export type ScenarioSuite = z.infer<typeof ScenarioSuiteSchema>;
