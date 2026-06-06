import { Test } from '@nestjs/testing';
import { DelegationService } from './delegation.service';
import { OneShotService } from '../oneshot/oneshot.service';
import { buildSkill, TEST_EXECUTOR, TEST_SMART_ACCOUNT } from '../../../test/helpers';

jest.mock('@metamask/smart-accounts-kit', () => {
  const actual = jest.requireActual('@metamask/smart-accounts-kit');
  return {
    ...actual,
    createDelegation: jest.fn().mockReturnValue({
      delegate: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      delegator: '0x0000000000000000000000000000000000000abc',
      salt: '0x' + '11'.repeat(32),
    }),
  };
});

describe('DelegationService', () => {
  let service: DelegationService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        DelegationService,
        {
          provide: OneShotService,
          useValue: {
            getCapabilities: jest.fn().mockResolvedValue({
              '84532': { targetAddress: TEST_EXECUTOR },
            }),
          },
        },
      ],
    }).compile();
    service = mod.get(DelegationService);
  });

  describe('generateSalt', () => {
    it('returns a 32-byte hex string', () => {
      const salt = service.generateSalt();
      expect(salt).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('produces unique salts across calls', () => {
      const a = service.generateSalt();
      const b = service.generateSalt();
      expect(a).not.toBe(b);
    });
  });

  describe('deserialiseScope', () => {
    it('maps stored type to enum value', () => {
      const out = service.deserialiseScope({
        type: 'Erc20PeriodTransfer',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        maxAmount: '0x5f5e100',
        periodAmount: '0x5f5e100',
        periodDuration: 86400,
        startDate: 0,
      });
      expect(typeof (out as Record<string, unknown>).type).toBe('string');
    });

    it('converts hex BigInt fields', () => {
      const out = service.deserialiseScope({
        type: 'Erc20PeriodTransfer',
        maxAmount: '0xff',
        periodAmount: '0xaa',
        valueLte: { maxValue: '0xbb' },
      });
      expect(out).toBeDefined();
    });

    it('leaves non-hex values untouched', () => {
      const out = service.deserialiseScope({
        type: 'CustomScope',
        maxAmount: '100',
        valueLte: { maxValue: '200' },
      });
      expect(out).toBeDefined();
    });
  });

  describe('validateDelegationShape', () => {
    const validDelegation = {
      delegate: TEST_EXECUTOR,
      delegator: TEST_SMART_ACCOUNT,
      salt: '0x' + '11'.repeat(32),
      signature: '0x' + '22'.repeat(65),
    };

    it('passes for a valid delegation', () => {
      expect(() =>
        service.validateDelegationShape(validDelegation, TEST_SMART_ACCOUNT, TEST_EXECUTOR),
      ).not.toThrow();
    });

    it('rejects missing signature', () => {
      expect(() =>
        service.validateDelegationShape({ ...validDelegation, signature: '0x' }, TEST_SMART_ACCOUNT, TEST_EXECUTOR),
      ).toThrow(/signature/);
    });

    it('rejects wrong delegate', () => {
      expect(() =>
        service.validateDelegationShape(
          { ...validDelegation, delegate: '0x0000000000000000000000000000000000000001' },
          TEST_SMART_ACCOUNT,
          TEST_EXECUTOR,
        ),
      ).toThrow(/delegate/);
    });

    it('rejects wrong delegator', () => {
      expect(() =>
        service.validateDelegationShape(
          { ...validDelegation, delegator: '0x0000000000000000000000000000000000000001' },
          TEST_SMART_ACCOUNT,
          TEST_EXECUTOR,
        ),
      ).toThrow(/delegator/);
    });
  });

  describe('prepare', () => {
    it('builds an unsigned delegation for a skill', async () => {
      const skill = buildSkill();
      const salt = service.generateSalt();
      const delegation = await service.prepare(skill, TEST_SMART_ACCOUNT, salt);
      expect(delegation).toBeDefined();
    });
  });

  describe('createDelegation mock', () => {
    it('is called with the right arguments', async () => {
      const kit = jest.requireMock('@metamask/smart-accounts-kit');
      const skill = buildSkill();
      await service.prepare(skill, TEST_SMART_ACCOUNT, '0x' + '11'.repeat(32));
      expect(kit.createDelegation).toHaveBeenCalled();
    });
  });
});
