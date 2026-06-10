import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PimlicoService } from '../src/modules/pimlico/pimlico.service';

describe('PimlicoService', () => {
  let service: PimlicoService;
  let fetchSpy: jest.SpyInstance;

  const PAYMASTER_URL = 'https://api.pimlico.io/v2/base-sepolia/rpc?apikey=test';
  const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PimlicoService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, unknown> = {
                'pimlico.paymasterUrl': PAYMASTER_URL,
                'pimlico.bundlerUrl': PAYMASTER_URL,
                'pimlico.sponsorshipPolicy': 'pol_test',
                'pimlico.execKey': 'test-key',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = mod.get<PimlicoService>(PimlicoService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  function mockFetch(result: unknown, ok = true) {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok,
      json: () => Promise.resolve({ result }),
    } as Response);
  }

  describe('eth_estimateUserOperationGas param format', () => {
    it('sends [userOp, entryPoint] — flat format per ERC-4337 spec', async () => {
      mockFetch({ callGasLimit: '0x100', verificationGasLimit: '0x100', preVerificationGas: '0x50' });

      await service.estimateUserOperationGas(
        {
          sender: '0x1234567890123456789012345678901234567890',
          callData: '0xabcdef',
          nonce: '0x0',
          maxFeePerGas: '0x0',
          maxPriorityFeePerGas: '0x0',
          signature: '0x',
        },
        ENTRY_POINT,
      );

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);

      expect(callBody.method).toBe('eth_estimateUserOperationGas');
      expect(callBody.params).toHaveLength(2);

      expect(callBody.params[0].sender).toBe('0x1234567890123456789012345678901234567890');
      expect(callBody.params[0].callData).toBe('0xabcdef');
      expect(callBody.params[0].nonce).toBe('0x0');
      expect(callBody.params[0].maxFeePerGas).toBe('0x0');
      expect(callBody.params[0].maxPriorityFeePerGas).toBe('0x0');
      expect(callBody.params[0].signature).toBe('0x');

      expect(callBody.params[0]).not.toHaveProperty('paymasterAndData');
      expect(callBody.params[0]).not.toHaveProperty('callGasLimit');
      expect(callBody.params[0]).not.toHaveProperty('preVerificationGas');

      expect(callBody.params[1]).toBe(ENTRY_POINT);
    });
  });

  describe('eth_sendUserOperation param format', () => {
    it('sends [userOp, entryPoint] — flat format per ERC-4337 spec', async () => {
      mockFetch('0x' + 'aa'.repeat(32));

      await service.sendUserOperation(
        {
          sender: '0x1234567890123456789012345678901234567890',
          nonce: '0x0',
          factory: '0x' as `0x${string}`,
          factoryData: '0x' as `0x${string}`,
          callData: '0xabcdef',
          callGasLimit: '0x100',
          verificationGasLimit: '0x100',
          preVerificationGas: '0x50',
          maxFeePerGas: '0x0',
          maxPriorityFeePerGas: '0x0',
          paymaster: '0x' as `0x${string}`,
          paymasterData: '0x' as `0x${string}`,
          paymasterVerificationGasLimit: '0x0',
          paymasterPostOpGasLimit: '0x0',
          signature: '0x',
        },
        ENTRY_POINT,
      );

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);

      expect(callBody.method).toBe('eth_sendUserOperation');
      expect(callBody.params).toHaveLength(2);
      expect(callBody.params[0].sender).toBe('0x1234567890123456789012345678901234567890');
      expect(callBody.params[1]).toBe(ENTRY_POINT);
    });
  });

  describe('eth_getUserOperationReceipt param format', () => {
    it('sends [userOpHash] — standard format', async () => {
      mockFetch({
        userOpHash: '0x' + 'bb'.repeat(32),
        entryPoint: ENTRY_POINT,
        sender: '0x1234567890123456789012345678901234567890',
        nonce: '0x0',
        paymaster: '0x0000000000000000000000000000000000000000',
        actualGasUsed: '0x100',
        actualGasCost: '0x100',
        success: true,
        receipt: {
          transactionHash: '0x' + 'cc'.repeat(32),
          blockNumber: '0x1',
          blockHash: '0x' + 'dd'.repeat(32),
          from: '0x' + 'ee'.repeat(20),
          to: '0x' + 'ff'.repeat(20),
          gasUsed: '0x100',
        },
      });

      const hash = '0x' + 'bb'.repeat(32) as `0x${string}`;
      const receipt = await service.getUserOperationReceipt(hash);

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);

      expect(callBody.method).toBe('eth_getUserOperationReceipt');
      expect(callBody.params).toEqual([hash]);
      expect(receipt).not.toBeNull();
      expect(receipt!.success).toBe(true);
    });
  });

  describe('pm_getPaymasterStubData param format', () => {
    it('sends [{ entryPoint, userOperation }] with sponsorshipPolicyId', async () => {
      mockFetch({
        paymaster: '0x' + '11'.repeat(20),
        paymasterData: '0x' + '22'.repeat(32),
        paymasterVerificationGasLimit: '0x0',
        paymasterPostOpGasLimit: '0x0',
      });

      await service.getPaymasterStubData(
        { sender: '0x1234567890123456789012345678901234567890', callData: '0xabc' },
        ENTRY_POINT,
        'pol_test',
      );

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);

      expect(callBody.method).toBe('pm_getPaymasterStubData');
      expect(callBody.params).toHaveLength(1);
      expect(callBody.params[0]).toHaveProperty('entryPoint');
      expect(callBody.params[0]).toHaveProperty('userOperation');
      expect(callBody.params[0]).toHaveProperty('sponsorshipPolicyId');
      expect(callBody.params[0].userOperation.sender).toBe('0x1234567890123456789012345678901234567890');
    });
  });

  describe('deployAndExecute', () => {
    it('completes full flow (stub → estimate → paymaster → send)', async () => {
      const stubResult = {
        paymaster: ('0x' + '11'.repeat(20)) as `0x${string}`,
        paymasterData: ('0x' + '22'.repeat(32)) as `0x${string}`,
        paymasterVerificationGasLimit: '0x0',
        paymasterPostOpGasLimit: '0x0',
      };
      const estimateResult = {
        callGasLimit: '0x100',
        verificationGasLimit: '0x200',
        preVerificationGas: '0x50',
      };
      const paymasterResult = {
        paymaster: ('0x' + '33'.repeat(20)) as `0x${string}`,
        paymasterData: ('0x' + '44'.repeat(32)) as `0x${string}`,
        paymasterVerificationGasLimit: '0x100',
        paymasterPostOpGasLimit: '0x200',
      };
      const sendResult = '0x' + '33'.repeat(32);

      fetchSpy = jest.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: stubResult }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: estimateResult }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: paymasterResult }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: sendResult }) } as Response);

      const userOpHash = await service.deployAndExecute({
        sender: '0x1234567890123456789012345678901234567890',
        initCode: ('0x' + 'aa'.repeat(20) + 'bb'.repeat(10)) as `0x${string}`,
        callData: '0x123456',
      });

      expect(userOpHash).toBe(sendResult);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
      const calls = fetchSpy.mock.calls.map((c) => JSON.parse(c[1].body).method);
      expect(calls).toEqual([
        'pm_getPaymasterStubData',
        'eth_estimateUserOperationGas',
        'pm_getPaymasterData',
        'eth_sendUserOperation',
      ]);

      const estimateBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(estimateBody.params[0].sender).toBe('0x1234567890123456789012345678901234567890');
      expect(estimateBody.params[0].callData).toBe('0x123456');
      expect(estimateBody.params[0].factory).toBe('0x' + 'aa'.repeat(20));
      expect(estimateBody.params[0].factoryData).toBe('0x' + 'bb'.repeat(10));
      expect(estimateBody.params[0]).not.toHaveProperty('paymasterAndData');
      expect(estimateBody.params[1]).toBe(ENTRY_POINT);

      const sendBody = JSON.parse(fetchSpy.mock.calls[3][1].body);
      expect(sendBody.params[0].paymaster).toBe(paymasterResult.paymaster);
      expect(sendBody.params[0].paymasterData).toBe(paymasterResult.paymasterData);
      expect(sendBody.params[0].paymasterVerificationGasLimit).toBe(paymasterResult.paymasterVerificationGasLimit);
      expect(sendBody.params[0].paymasterPostOpGasLimit).toBe(paymasterResult.paymasterPostOpGasLimit);
      expect(sendBody.params[1]).toBe(ENTRY_POINT);
    });
  });
});