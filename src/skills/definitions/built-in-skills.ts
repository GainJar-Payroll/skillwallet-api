import { CreateSkillDefinitionDto } from '../dto/create-skill-definition.dto';

const DCA_SUPPORTED_CHAINS = [
  1, 10, 56, 130, 137, 143, 146, 8453, 11155111, 42161, 42220, 59144,
] as const;

export const builtInSkills: CreateSkillDefinitionDto[] = [
  {
    skillId: 'dca-generic',
    slug: 'dca-generic',
    name: 'DCA (Generic)',
    description:
      'Automated dollar-cost averaging between any two ERC-20 tokens. Pick a tokenIn/tokenOut pair at install time; the skill spends a fixed tokenIn amount per period and routes to tokenOut back to your smart account. v1 allowlist: Sepolia = USDC, WETH. Set allowCustomToken=true to opt out of the allowlist (use with care). Supported on Ethereum, Linea, Arbitrum, Optimism, BNB Chain, Base, Polygon, Sonic, Unichain, Monad, and Celo.',
    adapter: 'dca',
    status: 'live',
    supportedChains: [...DCA_SUPPORTED_CHAINS],
    defaultChainId: 8453,
    aiMode: 'none',
    permissionRequirements: [
      {
        chainId: 11155111,
        permissionType: 'erc20-token-periodic',
        requiredRuleTypes: ['expiry'],
        required: true,
        description: 'Spend limited tokenIn per period for scheduled DCA.',
      },
      {
        chainId: 8453,
        permissionType: 'erc20-token-periodic',
        requiredRuleTypes: ['expiry'],
        required: true,
        description: 'Spend limited tokenIn per period for scheduled DCA.',
      },
    ],
    permissionTemplate: {
      type: 'skillwallet.permission.v1',
      defaultSelectors: [],
      defaultTokens: [],
    },
    pricing: {
      type: 'fixed-duration',
      options: [
        {
          id: 'monthly',
          label: '1 Month',
          durationDays: 30,
          skillFeeUsdc: '0.50',
        },
        {
          id: 'quarterly',
          label: '3 Months',
          durationDays: 90,
          skillFeeUsdc: '1.20',
          recommended: true,
        },
        {
          id: 'annual',
          label: '12 Months',
          durationDays: 365,
          skillFeeUsdc: '4.00',
        },
      ],
    },
    defaultSchedule: {
      type: 'recurring',
      frequency: 'weekly',
      timezone: 'UTC',
    },
    metadata: {
      icon: 'dca',
      tags: ['dca', 'generic', 'erc20', 'multi-chain'],
      riskLevel: 'medium',
    },
  },
  {
    skillId: 'aerodrome-vote-optimizer',
    slug: 'aerodrome-vote-optimizer',
    name: 'Aerodrome Vote Optimizer',
    description:
      'Optimize your locked AERO (veAERO) vote allocation across Aerodrome pools on Base. Selects pools based on reward density and risk profile during the weekly voting window.',
    adapter: 'aerodrome-vote',
    status: 'adapter-ready',
    supportedChains: [8453],
    defaultChainId: 8453,
    aiMode: 'optional',
    permissionTemplate: {
      type: 'skillwallet.permission.v1',
      defaultSelectors: [],
      defaultTokens: ['AERO', 'veAERO'],
    },
    pricing: {
      type: 'fixed-duration',
      options: [
        {
          id: 'monthly',
          label: '1 Month',
          durationDays: 30,
          skillFeeUsdc: '1.00',
        },
        {
          id: 'quarterly',
          label: '3 Months',
          durationDays: 90,
          skillFeeUsdc: '2.50',
          recommended: true,
        },
      ],
    },
    defaultSchedule: {
      type: 'epoch-aware',
      timezone: 'UTC',
    },
    metadata: {
      icon: 'aerodrome',
      tags: ['aerodrome', 've-aero', 'voting', 'optimization'],
      riskLevel: 'medium',
    },
  },
];
