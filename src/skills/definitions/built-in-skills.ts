import { CreateSkillDefinitionDto } from '../dto/create-skill-definition.dto';

export const builtInSkills: CreateSkillDefinitionDto[] = [
  {
    skillId: 'dca-usdc-weth',
    slug: 'dca-usdc-weth',
    name: 'DCA USDC → WETH',
    description:
      'Automated dollar-cost averaging from USDC to WETH on Base. Spend a fixed USDC amount per period and receive WETH back to your smart account.',
    adapter: 'dca',
    status: 'live',
    supportedChains: [8453],
    defaultChainId: 8453,
    aiMode: 'none',
    permissionTemplate: {
      type: 'skillwallet.permission.v1',
      defaultSelectors: [],
      defaultTokens: ['USDC', 'WETH'],
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
      tags: ['dca', 'usdc', 'weth', 'base'],
      riskLevel: 'medium',
    },
  },
  {
    skillId: 'aerodrome-vote-optimizer',
    slug: 'aerodrome-vote-optimizer',
    name: 'Aerodrome Vote Optimizer',
    description:
      'Optimize your locked AERO (veAERO) vote allocation across Aerodrome pools. Selects pools based on reward density and risk profile during the weekly voting window.',
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