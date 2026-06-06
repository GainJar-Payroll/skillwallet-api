import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SkillsService } from './skills.service';
import { Skill } from './schemas/skill.schema';
import { Installation } from '../installations/schemas/installation.schema';
import {
  buildInstallation,
  buildMockInstallationModel,
  buildMockSkillModel,
  buildSkill,
} from '../../../test/helpers';

describe('SkillsService', () => {
  let service: SkillsService;
  let model: ReturnType<typeof buildMockSkillModel>;
  let installationModel: ReturnType<typeof buildMockInstallationModel>;

  beforeEach(async () => {
    model = buildMockSkillModel();
    installationModel = buildMockInstallationModel();
    const mod = await Test.createTestingModule({
      providers: [
        SkillsService,
        { provide: getModelToken(Skill.name), useValue: model },
        { provide: getModelToken(Installation.name), useValue: installationModel },
      ],
    }).compile();
    service = mod.get(SkillsService);
  });

  describe('findAll', () => {
    it('returns only active when onlyActive=true', async () => {
      const skill = buildSkill();
      model.__seed(skill);
      const out = await service.findAll(true);
      expect(Array.isArray(out)).toBe(true);
    });

    it('adds installation summary when wallet params are provided', async () => {
      model.__seed(buildSkill());
      const installation = installationModel.__seed(
        buildInstallation({
          status: 'active',
        }),
      );

      const out = await service.findAll({
        onlyActive: true,
        userAddress: installation.userAddress,
        smartAccountAddress: installation.smartAccountAddress,
      });

      expect(out[0].installation).toEqual(
        expect.objectContaining({
          id: String(installation._id),
          status: 'active',
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns a seeded skill', async () => {
      const s = model.__seed(buildSkill());
      const out = await service.findById(s.skillId);
      expect(out.name).toBe('DCA Daily');
    });

    it('throws NotFound for unknown id', async () => {
      await expect(service.findById(String(new Types.ObjectId()))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('rejects cron without expression', async () => {
      await expect(
        service.create({
          name: 'X',
          description: 'Y',
          iconUrl: 'Z',
          runType: 'cron',
          chainId: 84532,
          delegationScope: { type: 'Erc20PeriodTransfer' },
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects event-trigger without config', async () => {
      await expect(
        service.create({
          name: 'X',
          description: 'Y',
          iconUrl: 'Z',
          runType: 'event-trigger',
          chainId: 84532,
          delegationScope: { type: 'Erc20PeriodTransfer' },
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a valid cron skill', async () => {
      const out = await service.create({
        name: 'DCA Daily',
        skillId: 'generic-dca-84532',
        description: 'X',
        iconUrl: 'I',
        runType: 'cron',
        cronExpression: '0 0 * * *',
        chainId: 84532,
        delegationScope: { type: 'Erc20PeriodTransfer' },
      } as never);
      expect(out.name).toBe('DCA Daily');
      expect(model.create).toHaveBeenCalled();
    });

    it('creates a valid cron skill from normalized trigger only', async () => {
      const out = await service.create({
        name: 'DCA Daily',
        skillId: 'generic-dca-84532',
        description: 'X',
        iconUrl: 'I',
        runType: 'cron',
        trigger: { type: 'cron', cronExpression: '0 9 * * *' },
        chainId: 84532,
        delegationScope: { type: 'Erc20PeriodTransfer' },
      } as never);
      expect(out.trigger).toEqual({ type: 'cron', cronExpression: '0 9 * * *' });
    });

    it('normalizes legacy DCA metadata to execution config on create', async () => {
      const out = await service.create({
        name: 'Generic DCA',
        skillId: 'generic-dca-84532',
        description: 'X',
        iconUrl: 'I',
        runType: 'cron',
        cronExpression: '0 0 * * *',
        chainId: 84532,
        delegationScope: { type: 'FunctionCall' },
        metadata: { kind: 'dca' },
      } as never);
      expect(out.execution).toEqual({ kind: 'dca-uniswap-v3' });
    });
  });

  describe('update', () => {
    it('updates an existing skill', async () => {
      const s = model.__seed(buildSkill());
      const out = await service.update(String(s._id), { description: 'New' } as never);
      expect(model.findById).toHaveBeenCalled();
      expect(out).toBeDefined();
    });

    it('throws NotFound when skill missing', async () => {
      await expect(
        service.update(String(new Types.ObjectId()), { description: 'x' } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft-deletes by setting isActive=false', async () => {
      const s = model.__seed(buildSkill());
      await service.remove(String(s._id));
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        String(s._id),
        { isActive: false },
        { new: true },
      );
    });
  });

  describe('upsertByName', () => {
    it('upserts and returns object', async () => {
      const out = await service.upsertByName('DCA Daily', buildSkill() as never);
      expect(out.name).toBe('DCA Daily');
      expect(model.findOneAndUpdate).toHaveBeenCalled();
    });
  });
});
