import type {
  ProofStatus,
  SkillAdapterKind,
  SkillMetadata,
  SkillPricing,
  SkillSchedule,
  SkillStatus,
  SupportedPair,
} from './schemas/skill-definition.schema';

export interface BuiltInSkillDefinition {
  skillId: string;
  slug: string;
  name: string;
  description: string;
  status: SkillStatus;
  permissionPath: 'low-level-function-call-delegation';
  adapter: SkillAdapterKind;
  executionMode: SkillAdapterKind;
  proofStatus: ProofStatus;
  supportedChains: number[];
  supportedPairs: SupportedPair[];
  pricing: SkillPricing;
  schedule: SkillSchedule;
  metadata: SkillMetadata;
}

export const builtInSkills: BuiltInSkillDefinition[] = [
  {
    skillId: 'direct-router-dca',
    slug: 'direct-router-dca',
    name: 'Direct Router DCA',
    description:
      'DCA strategy that performs a fee + approve + swap batch using a low-level FunctionCall delegation. Proven on Base Sepolia, target production on Base.',
    status: 'live',
    permissionPath: 'low-level-function-call-delegation',
    adapter: 'direct-router-dca',
    executionMode: 'direct-router-dca',
    proofStatus: 'proven-on-base-sepolia',
    supportedChains: [84532, 8453],
    supportedPairs: [
      {
        chainId: 84532,
        tokenIn: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        tokenOut: '0x4200000000000000000000000000000000000006',
      },
      {
        chainId: 8453,
        tokenIn: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        tokenOut: '0x4200000000000000000000000000000000000006',
      },
    ],
    pricing: { kind: 'free' },
    schedule: { supportedFrequencies: ['daily', 'weekly', 'monthly'] },
    metadata: {
      proofTxHash: '0x83027a8f3e9a55378a5a92a5ea9459a57bea0e89a69fc9b7f3cc5e06eb2e86d1',
      proofChainId: 84532,
      proofRelayer: '1shot',
      riskLevel: 'medium',
      tags: ['dca', 'uniswap-v3'],
    },
  },
  {
    skillId: 'gm-self-call',
    slug: 'gm-self-call',
    name: 'GM Self Call',
    description:
      'Toy proof skill that bundles a real 1Shot fee payment with a smart-account self-call probe. It is intentionally minimal and may revert if the account rejects the probe call.',
    status: 'internal',
    permissionPath: 'low-level-function-call-delegation',
    adapter: 'gm-self-call',
    executionMode: 'gm-self-call',
    proofStatus: 'not-proven',
    supportedChains: [84532, 8453],
    supportedPairs: [],
    pricing: { kind: 'free' },
    schedule: { supportedFrequencies: ['daily', 'weekly', 'monthly'] },
    metadata: {
      riskLevel: 'low',
      tags: ['proof', 'self-call'],
    },
  },
];
