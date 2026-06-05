import { describe, expect, it } from 'bun:test';
import { GmSelfCallAdapter } from '../src/runtime/adapters/gm-self-call.adapter';

const SMART_ACCOUNT = ('0x' + '11'.repeat(20)) as `0x${string}`;
const USER = ('0x' + '22'.repeat(20)) as `0x${string}`;
const PAYMENT_TOKEN = ('0x' + '33'.repeat(20)) as `0x${string}`;
const FEE_COLLECTOR = ('0x' + '44'.repeat(20)) as `0x${string}`;
const DELEGATE = ('0x' + '55'.repeat(20)) as `0x${string}`;

describe('GmSelfCallAdapter', () => {
  const adapter = new GmSelfCallAdapter();

  it('parses a valid gm-self-call config', () => {
    expect(() => adapter.parseConfig({ type: 'gm-self-call', frequency: 'weekly' })).not.toThrow();
  });

  it('rejects invalid gm-self-call config', () => {
    expect(() => adapter.parseConfig({ type: 'gm-self-call', frequency: 'hourly' })).toThrow();
  });

  it('prepares a fee transfer plus honest self-call probe', async () => {
    const prepared = await adapter.prepare({
      skillId: 'gm-self-call',
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      chainId: 84532,
      now: new Date('2026-06-05T00:00:00.000Z'),
      config: { type: 'gm-self-call', frequency: 'daily', note: 'gm' },
      relay: {
        delegate: DELEGATE,
        feeCollector: FEE_COLLECTOR,
        paymentToken: PAYMENT_TOKEN,
        requiredPaymentAmount: '12345',
      },
      expiresAt: new Date('2026-07-05T00:00:00.000Z'),
    });

    expect(prepared.previewCalls).toHaveLength(2);
    expect(prepared.previewCalls[0].target).toBe(PAYMENT_TOKEN);
    expect(prepared.previewCalls[1].target).toBe(SMART_ACCOUNT);
    expect(prepared.previewCalls[1].callData).toBe('0x00000000');
  });

  it('builds a runtime bundle for gm-self-call', async () => {
    const built = await adapter.buildAction(
      {
        installationId: 'inst_gm_1',
        userAddress: USER,
        smartAccountAddress: SMART_ACCOUNT,
        chainId: 84532,
        now: new Date('2026-06-05T00:00:00.000Z'),
        config: { type: 'gm-self-call', frequency: 'daily', note: 'gm' },
        relay: {
          delegate: DELEGATE,
          feeCollector: FEE_COLLECTOR,
          paymentToken: PAYMENT_TOKEN,
          requiredPaymentAmount: '12345',
        },
        grant: {
          grantId: 'grant_gm_1',
          chainId: 84532,
          delegator: SMART_ACCOUNT,
          delegate: DELEGATE,
          permissionContext: [],
        },
      },
      { type: 'gm-self-call', frequency: 'daily', note: 'gm' },
    );

    expect(built.executions).toHaveLength(2);
    expect(built.executions[1].actions[0].target).toBe(SMART_ACCOUNT);
    expect(built.executions[1].actions[0].callData).toBe('0x00000000');
  });
});
