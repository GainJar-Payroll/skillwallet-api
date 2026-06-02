import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { SkillInstallation, SkillInstallationDocument } from './schemas/skill-installation.schema';
import { CreateInstallationDto, ListInstallationsQuery, UpdateInstallationStatusDto } from './dto/create-installation.dto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { normalizeAddress } from '../common/utils/address';
import { addDays } from '../common/utils/time';

@Injectable()
export class InstallationsService {
  constructor(
    @InjectModel(SkillInstallation.name)
    private readonly installationModel: Model<SkillInstallationDocument>,
  ) {}

  async list(query: ListInstallationsQuery): Promise<SkillInstallation[]> {
    const filter: Record<string, unknown> = {};
    if (query.userAddress) {
      filter.userAddressNormalized = normalizeAddress(query.userAddress);
    }
    if (query.chainId !== undefined) {
      filter.chainId = query.chainId;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.skillId) {
      filter.skillId = query.skillId;
    }
    return this.installationModel.find(filter).lean();
  }

  async findById(installationId: string): Promise<SkillInstallation> {
    const installation = await this.installationModel.findOne({ installationId }).lean();
    if (!installation) {
      throw new AppError(ErrorCode.NOT_FOUND, `Installation not found: ${installationId}`);
    }
    return installation;
  }

  async createDraft(input: CreateInstallationDto, executorAddress: string, permissionManifest: Record<string, unknown>): Promise<SkillInstallation> {
    const installationId = `inst_${uuidv4()}`;
    const now = new Date();
    const expiresAt = addDays(now, input.pricingPlan.durationDays);

    const doc = await this.installationModel.create({
      installationId,
      userAddress: input.userAddress,
      userAddressNormalized: normalizeAddress(input.userAddress),
      smartAccountAddress: input.smartAccountAddress,
      smartAccountAddressNormalized: normalizeAddress(input.smartAccountAddress),
      chainId: input.chainId,
      skillId: input.skillId,
      adapter: input.config.type,
      executorAddress,
      executorAddressNormalized: normalizeAddress(executorAddress),
      status: 'pending_permission',
      config: input.config as unknown as Record<string, unknown>,
      permissionManifest,
      budget: input.budget ?? {},
      pricingPlan: input.pricingPlan,
      schedule: {
        nextRunAt: input.schedule.startAt ? new Date(input.schedule.startAt) : null,
        lastRunAt: null,
        expiresAt,
        frequency: input.schedule.frequency,
        timezone: input.schedule.timezone ?? 'UTC',
      },
      runtime: {
        lockedAt: null,
        lockReason: null,
        failureCount: 0,
        lastError: null,
      },
    });
    return doc.toObject();
  }

  async updateStatus(installationId: string, input: UpdateInstallationStatusDto): Promise<SkillInstallation> {
    const installation = await this.installationModel.findOne({ installationId });
    if (!installation) {
      throw new AppError(ErrorCode.NOT_FOUND, `Installation not found: ${installationId}`);
    }
    installation.status = input.status;
    await installation.save();
    return installation.toObject();
  }

  async pause(installationId: string): Promise<SkillInstallation> {
    return this.updateStatus(installationId, { status: 'paused' });
  }

  async resume(installationId: string): Promise<SkillInstallation> {
    return this.updateStatus(installationId, { status: 'active' });
  }

  async revoke(installationId: string): Promise<SkillInstallation> {
    return this.updateStatus(installationId, { status: 'revoked' });
  }

  async setPermissionRequest(installationId: string, request: Record<string, unknown>): Promise<void> {
    await this.installationModel.updateOne({ installationId }, { $set: { walletPermissionRequest: request } });
  }

  async setPermissionGrant(installationId: string, grant: Record<string, unknown>, delegation?: Record<string, unknown>): Promise<void> {
    const update: Record<string, unknown> = { walletPermissionGrant: grant };
    if (delegation) {
      update.delegation = delegation;
    }
    await this.installationModel.updateOne({ installationId }, { $set: update });
  }

  async lockInstallation(installationId: string, lockReason: string): Promise<boolean> {
    const result = await this.installationModel.updateOne(
      { installationId, $or: [{ 'runtime.lockedAt': null }, { 'runtime.lockedAt': { $exists: false } }] },
      { $set: { 'runtime.lockedAt': new Date(), 'runtime.lockReason': lockReason } },
    );
    return result.modifiedCount > 0;
  }

  async unlockInstallation(installationId: string): Promise<void> {
    await this.installationModel.updateOne(
      { installationId },
      { $set: { 'runtime.lockedAt': null, 'runtime.lockReason': null } },
    );
  }

  async recordFailure(installationId: string, error: string): Promise<void> {
    await this.installationModel.updateOne(
      { installationId },
      {
        $inc: { 'runtime.failureCount': 1 },
        $set: { 'runtime.lastError': error },
      },
    );
  }

  async updateNextRunAt(installationId: string, nextRunAt: Date | null, lastRunAt?: Date): Promise<void> {
    const update: Record<string, unknown> = { 'schedule.nextRunAt': nextRunAt };
    if (lastRunAt) {
      update['schedule.lastRunAt'] = lastRunAt;
    }
    await this.installationModel.updateOne({ installationId }, { $set: update });
  }

  async findDueInstallations(now: Date): Promise<SkillInstallation[]> {
    return this.installationModel
      .find({
        status: 'active',
        'schedule.expiresAt': { $gt: now },
        'schedule.nextRunAt': { $lte: now },
        $or: [{ 'runtime.lockedAt': null }, { 'runtime.lockedAt': { $exists: false } }],
      })
      .lean();
  }
}