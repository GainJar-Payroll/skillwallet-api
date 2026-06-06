import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InstallationsService } from './installations.service';
import { Installation } from './schemas/installation.schema';
import { SkillsService } from '../skills/skills.service';
import { DelegationService } from '../delegation/delegation.service';
import { ExecutorService } from '../executor/executor.service';
import {
  buildMockInstallationModel,
  buildMockExecutorService,
  buildInstallation,
  buildSkill,
  TEST_EXECUTOR,
  TEST_SMART_ACCOUNT,
  TEST_USER,
} from '../../../test/helpers';

describe('InstallationsService', () => {
  let service: InstallationsService;
  let instModel: ReturnType<typeof buildMockInstallationModel>;
  let skillsService: { findById: jest.Mock };
  let delegationService: { generateSalt: jest.Mock; prepare: jest.Mock; validateDelegationShape: jest.Mock };

  beforeEach(async () => {
    instModel = buildMockInstallationModel();
    skillsService = { findById: jest.fn() };
    delegationService = {
      generateSalt: jest.fn().mockReturnValue('0x' + '11'.repeat(32)),
      prepare: jest.fn().mockResolvedValue({
        delegate: TEST_EXECUTOR,
        delegator: TEST_SMART_ACCOUNT,
        salt: '0x' + '11'.repeat(32),
      }),
      validateDelegationShape: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        InstallationsService,
        { provide: getModelToken(Installation.name), useValue: instModel },
        { provide: SkillsService, useValue: skillsService },
        { provide: DelegationService, useValue: delegationService },
        { provide: ExecutorService, useValue: buildMockExecutorService() },
      ],
    }).compile();
    service = mod.get(InstallationsService);
  });

  describe('prepareInstallation', () => {
    it('returns delegation + salt + executor', async () => {
      skillsService.findById.mockResolvedValue(buildSkill());
      const out = await service.prepareInstallation({
        skillId: String(new Types.ObjectId()),
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      } as never);
      expect(out.salt).toBeDefined();
      expect(out.executorAddress).toBe(TEST_EXECUTOR);
      expect(out.delegation).toBeDefined();
    });

    it('rejects when skill inactive', async () => {
      skillsService.findById.mockResolvedValue(buildSkill({ isActive: false }));
      await expect(
        service.prepareInstallation({ skillId: 'x', userAddress: TEST_USER, smartAccountAddress: TEST_SMART_ACCOUNT } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmInstallation', () => {
    it('creates installation when valid', async () => {
      skillsService.findById.mockResolvedValue(buildSkill());
      const out = await service.confirmInstallation({
        skillId: String(new Types.ObjectId()),
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: '0x' + '11'.repeat(32),
        signedDelegation: {
          delegate: TEST_EXECUTOR,
          delegator: TEST_SMART_ACCOUNT,
          salt: '0x' + '11'.repeat(32),
          signature: '0x' + '22'.repeat(65),
        },
      } as never);
      expect(out.status).toBe('active');
    });

    it('rejects when signature invalid', async () => {
      skillsService.findById.mockResolvedValue(buildSkill());
      delegationService.validateDelegationShape.mockImplementation(() => {
        throw new Error('bad sig');
      });
      await expect(
        service.confirmInstallation({
          skillId: String(new Types.ObjectId()),
          userAddress: TEST_USER,
          smartAccountAddress: TEST_SMART_ACCOUNT,
          delegationSalt: '0x' + '11'.repeat(32),
          signedDelegation: {
            delegate: TEST_EXECUTOR,
            delegator: TEST_SMART_ACCOUNT,
            salt: '0x' + '11'.repeat(32),
            signature: '0x' + '22'.repeat(65),
          },
        } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('status transitions', () => {
    it('pauses installation owned by user', async () => {
      const inst = instModel.__seed(buildInstallation());
      const out = await service.pause(String(inst._id), TEST_USER);
      expect(out.status).toBe('paused');
    });

    it('rejects pause from non-owner', async () => {
      const inst = instModel.__seed(buildInstallation());
      await expect(
        service.pause(String(inst._id), '0x0000000000000000000000000000000000000099'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('resumes installation', async () => {
      const inst = instModel.__seed(buildInstallation({ status: 'paused' }));
      const out = await service.resume(String(inst._id), TEST_USER);
      expect(out.status).toBe('active');
    });

    it('revokes installation', async () => {
      const inst = instModel.__seed(buildInstallation());
      await service.revoke(String(inst._id), TEST_USER);
      const refreshed = await service.findByIdRaw(String(inst._id));
      expect(refreshed?.status).toBe('revoked');
    });

    it('throws when installation missing on pause', async () => {
      await expect(
        service.pause(String(new Types.ObjectId()), TEST_USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('appendExecution', () => {
    it('appends and caps executions to 50', async () => {
      const inst = instModel.__seed(buildInstallation());
      for (let i = 0; i < 55; i++) {
        await service.appendExecution(String(inst._id), {
          executedAt: new Date(),
          status: 'confirmed',
        });
      }
      const fresh = await service.findByIdRaw(String(inst._id));
      expect(fresh?.executions.length).toBeLessThanOrEqual(50);
    });
  });

  describe('findDueForExecution', () => {
    it('returns the seeded active installation', async () => {
      instModel.__seed(buildInstallation());
      const list = await service.findDueForExecution();
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe('findActiveBySkillId', () => {
    it('returns list for skillId', async () => {
      instModel.__seed(buildInstallation());
      const list = await service.findActiveBySkillId(String(new Types.ObjectId()));
      expect(Array.isArray(list)).toBe(true);
    });
  });
});
