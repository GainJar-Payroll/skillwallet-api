import { describe, it, expect } from 'bun:test';
import { grantInstallationSchema } from '../src/installations/dto/grant-installation.dto';

const SA = ('0x' + '11'.repeat(20)) as `0x${string}`;
const USER = ('0x' + '33'.repeat(20)) as `0x${string}`;
const DELEGATE = '0x02c9979a75fbdbc3a77485024ab8b6474308591e' as `0x${string}`;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;
const WETH = '0x4200000000000000000000000000000000000006' as `0x${string}`;
const SWAP = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as `0x${string}`;
const H32 = (c: string) => ('0x' + c.repeat(32)) as `0x${string}`;
const SIG65 = ('0x' + '22'.repeat(65)) as `0x${string}`;

function makeSignedDelegation() {
  return {
    delegate: DELEGATE,
    delegator: SA,
    authority: H32('00'),
    caveats: [],
    salt: H32('11'),
    signature: SIG65,
  };
}

function makeDcaPrepareSnapshot() {
  return {
    skillId: 'direct-router-dca',
    adapter: 'direct-router-dca' as const,
    chainId: 84532,
    smartAccountAddress: SA,
    delegate: DELEGATE,
    feeCollector: ('0x' + '44'.repeat(20)) as `0x${string}`,
    paymentToken: USDC,
    requiredPaymentAmount: '10000',
    amountOut: '123456789',
    minAmountOut: '122000000',
    delegationScope: {
      type: 'function-call' as const,
      targets: [USDC, SWAP],
      selectors: ['0xa9059cbb', '0x095ea7b3', '0x04e45aaf'],
      valueLte: { maxValue: '0x0' as const },
    },
    configSnapshot: {
      type: 'direct-router-dca' as const,
      tokenIn: { address: USDC },
      tokenOut: { address: WETH },
      amountPerRun: '1000000',
      frequency: 'daily' as const,
      maxSlippageBps: 100,
      router: { name: 'uniswap-v3' as const, address: SWAP },
      feeTier: 3000 as const,
      recipient: SA,
      quoteMode: 'router-quote' as const,
      quotedAmountOut: '123456789',
      minAmountOut: '122000000',
    },
    review: {
      amountOut: '123456789',
      minAmountOut: '122000000',
    },
    expiresAt: '2026-12-31T23:59:59.000Z',
  };
}

function makeGmPrepareSnapshot() {
  return {
    skillId: 'gm-self-call',
    adapter: 'gm-self-call' as const,
    chainId: 84532,
    smartAccountAddress: SA,
    delegate: DELEGATE,
    feeCollector: ('0x' + '44'.repeat(20)) as `0x${string}`,
    paymentToken: USDC,
    requiredPaymentAmount: '10000',
    delegationScope: {
      type: 'function-call' as const,
      targets: [USDC, SA],
      selectors: ['0xa9059cbb', '0x00000000'],
      valueLte: { maxValue: '0x0' as const },
    },
    configSnapshot: {
      type: 'gm-self-call' as const,
      frequency: 'weekly' as const,
      note: 'gm',
    },
    review: {
      executionKind: 'self-call-probe',
      selfCallData: '0x00000000',
    },
    expiresAt: '2026-12-31T23:59:59.000Z',
  };
}

function makeValidGrant() {
  return {
    userAddress: USER,
    smartAccountAddress: SA,
    chainId: 84532,
    permissionPath: 'low-level-function-call-delegation' as const,
    prepareSnapshot: makeDcaPrepareSnapshot(),
    signedDelegation: makeSignedDelegation(),
    raw: { source: 'metaMaskSmartAccount.signDelegation' },
  };
}

describe('grantInstallationSchema', () => {
  it('accepts a valid dca grant payload', () => {
    expect(() => grantInstallationSchema.parse(makeValidGrant())).not.toThrow();
  });

  it('accepts a valid gm-self-call grant payload', () => {
    const payload = { ...makeValidGrant(), prepareSnapshot: makeGmPrepareSnapshot() };
    expect(() => grantInstallationSchema.parse(payload)).not.toThrow();
  });

  it('rejects missing prepareSnapshot', () => {
    const { prepareSnapshot: _omit, ...rest } = makeValidGrant();
    void _omit;
    expect(() => grantInstallationSchema.parse(rest)).toThrow(/prepareSnapshot/);
  });

  it('rejects wrong-format signature', () => {
    const g = makeValidGrant();
    g.signedDelegation = { ...makeSignedDelegation(), signature: '0xshort' as `0x${string}` };
    expect(() => grantInstallationSchema.parse(g)).toThrow();
  });

  it('accepts optional legacy permissionContext array', () => {
    const g = { ...makeValidGrant(), permissionContext: [makeSignedDelegation()] };
    expect(() => grantInstallationSchema.parse(g)).not.toThrow();
  });
});
