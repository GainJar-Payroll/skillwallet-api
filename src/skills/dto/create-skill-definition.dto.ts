import { z } from 'zod';

const pricingOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  durationDays: z.number().int().positive(),
  skillFeeUsdc: z.string().regex(/^\d+(\.\d+)?$/),
  recommended: z.boolean().optional(),
});

const pricingModelSchema = z.object({
  type: z.enum(['fixed-duration', 'per-execution', 'budget-based']),
  options: z.array(pricingOptionSchema).optional(),
  perExecutionUsdc: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  budgetUsdc: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  budgetPeriodDays: z.number().int().positive().optional(),
});

const scheduleTemplateSchema = z.object({
  type: z.enum(['recurring', 'epoch-aware', 'manual']),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  timezone: z.string().optional(),
});

const metadataSchema = z.object({
  icon: z.string().optional(),
  tags: z.array(z.string()).optional(),
  riskLevel: z.enum(['low', 'medium', 'high']),
});

const permissionRequirementSchema = z.object({
  chainId: z.number().int().positive(),
  permissionType: z.string().min(1),
  requiredRuleTypes: z.array(z.string().min(1)),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

export const createSkillDefinitionSchema = z.object({
  skillId: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  adapter: z.enum([
    'dca',
    'aerodrome-vote',
    'lp-keeper',
    'x402-research',
    'internal-native-transfer-proof',
  ]),
  status: z.enum(['live', 'adapter-ready', 'coming-soon', 'disabled', 'internal']),
  supportedChains: z.array(z.number().int().positive()).min(1),
  defaultChainId: z.number().int().positive(),
  aiMode: z.enum(['none', 'optional', 'required']),
  permissionRequirements: z.array(permissionRequirementSchema).optional(),
  permissionTemplate: z.record(z.string(), z.unknown()),
  pricing: pricingModelSchema,
  defaultSchedule: scheduleTemplateSchema,
  metadata: metadataSchema,
});

export type CreateSkillDefinitionDto = z.infer<typeof createSkillDefinitionSchema>;

export const updateSkillDefinitionSchema = createSkillDefinitionSchema.partial();

export type UpdateSkillDefinitionDto = z.infer<typeof updateSkillDefinitionSchema>;
