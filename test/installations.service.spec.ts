import { describe, expect, it } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { InstallationsService } from '../src/installations/installations.service';
import { AdapterRegistryService } from '../src/runtime/adapters/adapter-registry.service';
import { DirectRouterDcaAdapter } from '../src/runtime/adapters/direct-router-dca.adapter';
import { GmSelfCallAdapter } from '../src/runtime/adapters/gm-self-call.adapter';

const USER = ('0x' + '11'.repeat(20)) as `0x${string}`;
const SA = ('0x' + '22'.repeat(20)) as `0x${string}`;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;
const WETH = '0x4200000000000000000000000000000000000006' as `0x${string}`;
const SWAP = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as `0x${string}`;
const DELEGATE = ('0x' + '33'.repeat(20)) as `0x${string}`;
const FEE_COLLECTOR = ('0x' + '44'.repeat(20)) as `0x${string}`;

function makeService(skillsResponse: {
  skillId: string;
  name: string;
  adapter: string;
  executionMode?: string;
}) {
  const config = { get: () => undefined } as unknown as ConfigService;
  const dca = new DirectRouterDcaAdapter(config, {
    quoteExactInputSingle: async () => 500000n,
  } as never);
  const gm = new GmSelfCallAdapter();
  const registry = new AdapterRegistryService(dca, gm);
  const relayer = {
    getFeeData: async () => ({
      targetAddress: DELEGATE,
      feeCollector: FEE_COLLECTOR,
      minFee: '0.01',
    }),
  } as never;
  const skills = {
    getBySkillId: async () => skillsResponse,
  } as never;

  return new InstallationsService({} as never, {} as never, registry, relayer, skills, config);
}

describe('InstallationsService.prepare', () => {
  it('resolves direct-router-dca by skill metadata and returns dca preview calls', async () => {
    const service = makeService({
      skillId: 'direct-router-dca',
      name: 'Direct Router DCA',
      adapter: 'direct-router-dca',
    });

    const review = await service.prepare({
      userAddress: USER,
      smartAccountAddress: SA,
      chainId: 84532,
      skillId: 'direct-router-dca',
      config: {
        type: 'direct-router-dca',
        tokenIn: { address: USDC },
        tokenOut: { address: WETH },
        amountPerRun: '1000000',
        frequency: 'daily',
        maxSlippageBps: 100,
        router: { name: 'uniswap-v3', address: SWAP },
        feeTier: 3000,
        quoteMode: 'router-quote',
      },
    });

    expect(review.skill.adapter).toBe('direct-router-dca');
    expect(review.previewCalls).toHaveLength(3);
    expect(review.previewCalls[1].target).toBe(USDC);
    expect(review.amountOut).toBe('500000');
    expect((review.prepareSnapshot.configSnapshot as { recipient: string }).recipient).toBe(SA);
  });

  it('resolves gm-self-call by skill metadata and returns a generic self-call preview', async () => {
    const service = makeService({
      skillId: 'gm-self-call',
      name: 'GM Self Call',
      adapter: 'gm-self-call',
    });

    const review = await service.prepare({
      userAddress: USER,
      smartAccountAddress: SA,
      chainId: 84532,
      skillId: 'gm-self-call',
      config: {
        type: 'gm-self-call',
        frequency: 'weekly',
        note: 'gm',
      },
    });

    expect(review.skill.adapter).toBe('gm-self-call');
    expect(review.previewCalls).toHaveLength(2);
    expect(review.previewCalls[1].target).toBe(SA);
    expect(review.previewCalls[1].callData).toBe('0x00000000');
    expect(review.amountOut).toBeUndefined();
  });
});
