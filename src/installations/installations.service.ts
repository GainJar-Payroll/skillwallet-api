import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { parseUnits } from 'viem';
import { AdapterRegistryService } from '../runtime/adapters/adapter-registry.service';
import type {
  Frequency,
  PreparedExecutionCall,
  SkillAdapterKind,
  SkillConfig,
} from '../runtime/adapters/skill-adapter.interface';
import { OneShotRelayerService } from '../runtime/relayers/oneshot-relayer.service';
import { SkillsService } from '../skills/skills.service';
import type { SkillDefinitionDoc } from '../skills/schemas/skill-definition.schema';
import { isSupportedChain } from '../chains/registry/chains';
import { findToken, listTokensForChain } from '../chains/registry/tokens';
import { findDexRouter, listDexForChain } from '../chains/registry/dex';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Address, HexString } from '../common/types/evm';
import type { OneShotFeeData } from '../runtime/relayers/relayer.interface';
import { DEFAULT_PAYMENT_TOKEN_BY_CHAIN } from '../config/env.schema';
import { SkillInstallation, SkillInstallationDoc } from './schemas/skill-installation.schema';
import {
  DelegationGrant,
  DelegationGrantDoc,
} from '../delegations/schemas/delegation-grant.schema';
import {
  prepareInstallationSchema,
  PrepareInstallationInput,
} from './dto/prepare-installation.dto';
import { grantInstallationSchema, GrantInstallationInput } from './dto/grant-installation.dto';
import type {
  CreateInstallationDto,
  ListInstallationsQuery,
  UpdateInstallationStatusDto,
} from './dto/create-installation.dto';

export interface PermissionReview {
  prepareId: string;
  skill: { skillId: string; name: string; adapter: string };
  chainId: number;
  smartAccountAddress: string;
  delegate: Address;
  feeCollector: Address;
  paymentToken: Address;
  requiredPaymentAmount: string;
  amountOut?: string;
  minAmountOut?: string;
  allowedTargets: Array<{ address: Address; label: string }>;
  allowedSelectors: Array<{ selector: HexString; label: string }>;
  delegationScope: {
    type: 'function-call';
    targets: Address[];
    selectors: HexString[];
    valueLte: { maxValue: '0x0' };
  };
  previewCalls: PreparedExecutionCall[];
  prepareSnapshot: Record<string, unknown>;
  expiresAt: string;
}

@Injectable()
export class InstallationsService {
  private readonly logger = new Logger(InstallationsService.name);

  constructor(
    @InjectModel(SkillInstallation.name)
    private readonly model: Model<SkillInstallationDoc>,
    @InjectModel(DelegationGrant.name)
    private readonly grantModel: Model<DelegationGrantDoc>,
    private readonly adapterRegistry: AdapterRegistryService,
    private readonly relayer: OneShotRelayerService,
    private readonly skills: SkillsService,
    private readonly config: ConfigService,
  ) {}

  async prepare(input: PrepareInstallationInput): Promise<PermissionReview> {
    const parsed = prepareInstallationSchema.parse(input);
    if (!isSupportedChain(parsed.chainId)) {
      throw AppError.notConfigured(`chainId=${parsed.chainId}`, 'chain not in MVP supported set');
    }

    const skill = await this.skills.getBySkillId(parsed.skillId);
    const adapterKind = this.resolveAdapterKind(skill, parsed.skillType);
    const adapter = this.adapterRegistry.get(adapterKind);
    const normalizedConfig = this.lockConfigToSmartAccount(
      parsed.config,
      parsed.smartAccountAddress,
    );
    const config = this.adapterRegistry.parseConfig(adapterKind, normalizedConfig);

    const paymentToken = this.resolvePaymentToken(parsed.chainId);
    const feeData = await this.fetchFeeData(
      parsed.chainId,
      paymentToken,
      'failed to fetch 1Shot fee data',
    );
    const feeAmount = this.deriveFeeAmount(parsed.chainId, paymentToken, feeData);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const prepared = await adapter.prepare({
      skillId: parsed.skillId,
      userAddress: parsed.userAddress as Address,
      smartAccountAddress: parsed.smartAccountAddress as Address,
      chainId: parsed.chainId,
      now: new Date(),
      config,
      relay: {
        delegate: feeData.targetAddress as Address,
        feeCollector: feeData.feeCollector as Address,
        paymentToken,
        requiredPaymentAmount: feeAmount.toString(),
      },
      expiresAt,
    });

    const allowedTargets = this.buildAllowedTargets(
      parsed.chainId,
      prepared.previewCalls,
      prepared.labels?.targets,
    );
    const allowedSelectors = this.buildAllowedSelectors(
      prepared.previewCalls,
      prepared.labels?.selectors,
    );
    const delegationScope = {
      type: 'function-call' as const,
      targets: allowedTargets.map((target) => target.address),
      selectors: allowedSelectors.map((selector) => selector.selector),
      valueLte: { maxValue: '0x0' as const },
    };

    const prepareSnapshot = {
      skillId: parsed.skillId,
      adapter: adapterKind,
      chainId: parsed.chainId,
      smartAccountAddress: parsed.smartAccountAddress,
      delegate: feeData.targetAddress as Address,
      feeCollector: feeData.feeCollector as Address,
      paymentToken,
      requiredPaymentAmount: feeAmount.toString(),
      amountOut: prepared.review?.amountOut,
      minAmountOut: prepared.review?.minAmountOut,
      delegationScope,
      configSnapshot: prepared.configSnapshot,
      review: prepared.review,
      expiresAt: expiresAt.toISOString(),
    };

    this.logger.log(
      `prepare: skill=${parsed.skillId} adapter=${adapterKind} chainId=${parsed.chainId} smartAccount=${parsed.smartAccountAddress} delegate=${feeData.targetAddress}`,
    );

    return {
      prepareId: `prep_${uuidv4()}`,
      skill: { skillId: skill.skillId, name: skill.name, adapter: adapterKind },
      chainId: parsed.chainId,
      smartAccountAddress: parsed.smartAccountAddress,
      delegate: feeData.targetAddress as Address,
      feeCollector: feeData.feeCollector as Address,
      paymentToken,
      requiredPaymentAmount: feeAmount.toString(),
      amountOut: prepared.review?.amountOut,
      minAmountOut: prepared.review?.minAmountOut,
      allowedTargets,
      allowedSelectors,
      delegationScope,
      previewCalls: prepared.previewCalls,
      prepareSnapshot,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async grant(
    input: GrantInstallationInput,
  ): Promise<{ installation: SkillInstallationDoc; grant: DelegationGrantDoc }> {
    const parsed = grantInstallationSchema.parse(input);

    if (!isSupportedChain(parsed.chainId)) {
      throw AppError.notConfigured(`chainId=${parsed.chainId}`, 'chain not in MVP supported set');
    }
    if (parsed.prepareSnapshot.chainId !== parsed.chainId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'prepareSnapshot.chainId mismatch');
    }
    if (
      parsed.prepareSnapshot.smartAccountAddress.toLowerCase() !==
      parsed.smartAccountAddress.toLowerCase()
    ) {
      throw new AppError(
        ErrorCode.DELEGATION_DELEGATOR_MISMATCH,
        400,
        'prepareSnapshot.smartAccountAddress mismatch',
      );
    }
    if (
      parsed.signedDelegation.delegator.toLowerCase() !== parsed.smartAccountAddress.toLowerCase()
    ) {
      throw new AppError(
        ErrorCode.DELEGATION_DELEGATOR_MISMATCH,
        400,
        `signedDelegation.delegator ${parsed.signedDelegation.delegator} does not match smartAccountAddress ${parsed.smartAccountAddress}`,
      );
    }

    const paymentToken = this.resolvePaymentToken(parsed.chainId);
    const feeData = await this.fetchFeeData(
      parsed.chainId,
      paymentToken,
      'failed to verify 1Shot target on grant',
    );
    if (feeData.targetAddress.toLowerCase() !== parsed.signedDelegation.delegate.toLowerCase()) {
      throw new AppError(
        ErrorCode.DELEGATION_DELEGATE_MISMATCH,
        400,
        `signedDelegation.delegate ${parsed.signedDelegation.delegate} does not match 1Shot targetAddress ${feeData.targetAddress} for chainId ${parsed.chainId}`,
      );
    }
    if (parsed.prepareSnapshot.delegate.toLowerCase() !== feeData.targetAddress.toLowerCase()) {
      throw new AppError(
        ErrorCode.DELEGATION_DELEGATE_MISMATCH,
        400,
        'prepareSnapshot.delegate does not match live 1Shot targetAddress',
      );
    }

    const skill = await this.skills.getBySkillId(parsed.prepareSnapshot.skillId);
    const adapterKind = this.resolveAdapterKind(skill);
    if (parsed.prepareSnapshot.adapter !== adapterKind) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `prepareSnapshot.adapter ${parsed.prepareSnapshot.adapter} does not match skill adapter ${adapterKind}`,
      );
    }
    const config = this.adapterRegistry.parseConfig(
      adapterKind,
      parsed.prepareSnapshot.configSnapshot,
    );
    this.assertConfigLocksSmartAccount(config, parsed.smartAccountAddress);

    const installationId = `inst_${uuidv4()}`;
    const grantId = `grant_${uuidv4()}`;
    const nextRunAt = this.computeNextRunAt(config.frequency, new Date());
    const tokenInAddress = this.readAddress(config, 'tokenIn');
    const tokenOutAddress = this.readAddress(config, 'tokenOut');
    const tokenInMeta = tokenInAddress ? findToken(parsed.chainId, tokenInAddress) : undefined;
    const tokenOutMeta = tokenOutAddress ? findToken(parsed.chainId, tokenOutAddress) : undefined;

    let installation: SkillInstallationDoc | null = null;
    try {
      installation = await this.model.create({
        installationId,
        userAddress: parsed.userAddress,
        smartAccountAddress: parsed.smartAccountAddress,
        chainId: parsed.chainId,
        skillId: parsed.prepareSnapshot.skillId,
        skillType: adapterKind,
        status: 'active',
        config,
        budget: {
          maxRunsPerWeek: this.deriveMaxRunsPerWeek(config.frequency),
          maxSpendPerRun: this.readAmountPerRun(config),
        },
        pricing: { plan: 'free' },
        schedule: { frequency: config.frequency, nextRunAt, lastRunAt: null },
        runtime: {
          oneShotTargetAddress: feeData.targetAddress,
          oneShotFeeCollector: feeData.feeCollector,
          paymentToken,
          oneShotRequiredPaymentAmount: parsed.prepareSnapshot.requiredPaymentAmount,
          successCount: 0,
          failureCount: 0,
        },
        tokenInSymbol: tokenInMeta?.symbol,
        tokenOutSymbol: tokenOutMeta?.symbol,
      });

      const grant = await this.grantModel.create({
        grantId,
        installationId,
        chainId: parsed.chainId,
        delegator: parsed.smartAccountAddress,
        delegate: feeData.targetAddress,
        standard: 'low-level-function-call',
        status: 'redeemable',
        permissionContext: [parsed.signedDelegation],
        caveats: parsed.signedDelegation.caveats,
        signature: parsed.signedDelegation.signature,
        authority: parsed.signedDelegation.authority,
        expiresAt: new Date(parsed.prepareSnapshot.expiresAt),
        delegationScope: parsed.prepareSnapshot.delegationScope,
        constraints: parsed.prepareSnapshot.review ?? {},
      });

      this.logger.log(
        `grant: installation=${installation.installationId} grant=${grantId} chain=${parsed.chainId} adapter=${adapterKind} delegate=${feeData.targetAddress} smartAccount=${parsed.smartAccountAddress}`,
      );

      return { installation, grant };
    } catch (error) {
      if (installation) {
        await this.model
          .deleteOne({ installationId })
          .exec()
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async list(query: ListInstallationsQuery): Promise<SkillInstallationDoc[]> {
    const filter: Record<string, unknown> = {};
    if (query.userAddress) {
      filter.userAddress = { $regex: new RegExp(`^${query.userAddress}$`, 'i') };
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
    return this.model.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findById(installationId: string): Promise<SkillInstallationDoc> {
    return this.getByInstallationId(installationId);
  }

  async createDraft(
    input: CreateInstallationDto,
    executorAddress: string,
    permissionManifest: Record<string, unknown>,
  ): Promise<SkillInstallationDoc> {
    const installationId = `inst_${uuidv4()}`;
    const frequency =
      input.schedule?.frequency ??
      (input.config.type === 'dca' ? input.config.frequency : 'weekly');
    return this.model.create({
      installationId,
      userAddress: input.userAddress,
      userAddressNormalized: input.userAddress.toLowerCase(),
      smartAccountAddress: input.smartAccountAddress,
      smartAccountAddressNormalized: input.smartAccountAddress.toLowerCase(),
      chainId: input.chainId,
      skillId: input.skillId,
      adapter: input.config.type,
      skillType: input.config.type,
      executorAddress,
      executorAddressNormalized: executorAddress.toLowerCase(),
      status: 'pending_permission',
      config: input.config as unknown as Record<string, unknown>,
      permissionManifest,
      dependencies: [],
      budget: input.budget ?? {},
      pricingPlan: input.pricingPlan,
      pricing: { plan: input.pricingPlan.id, label: input.pricingPlan.label },
      schedule: {
        frequency,
        nextRunAt: input.schedule?.startAt ? new Date(input.schedule.startAt) : null,
        lastRunAt: null,
        timezone: input.schedule?.timezone ?? 'UTC',
      },
      runtime: {
        lockedAt: null,
        lockReason: null,
        failureCount: 0,
        lastError: null,
        successCount: 0,
      },
    });
  }

  async updateStatus(
    installationId: string,
    input: UpdateInstallationStatusDto,
  ): Promise<SkillInstallationDoc> {
    const doc = await this.getByInstallationId(installationId);
    doc.status = input.status as SkillInstallationDoc['status'];
    await doc.save();
    return doc;
  }

  async resume(installationId: string): Promise<SkillInstallationDoc> {
    return this.updateStatus(installationId, { status: 'active' });
  }

  async setPermissionRequest(
    installationId: string,
    request: Record<string, unknown>,
  ): Promise<void> {
    await this.model.updateOne({ installationId }, { $set: { walletPermissionRequest: request } });
  }

  async setWalletSupportCheck(
    installationId: string,
    check: Record<string, unknown>,
  ): Promise<void> {
    await this.model.updateOne({ installationId }, { $set: { walletSupportCheck: check } });
  }

  async setPermissionGrantAndActivate(
    installationId: string,
    grant: Record<string, unknown>,
    delegation?: Record<string, unknown>,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      walletPermissionGrant: grant,
      status: 'active',
    };
    if (delegation) {
      update.delegation = delegation;
    }
    await this.model.updateOne({ installationId }, { $set: update });
  }

  async setPermissionGrantDependencies(
    installationId: string,
    grant: Record<string, unknown>,
    delegation: Record<string, unknown> | undefined,
    dependencies: Array<Record<string, unknown>>,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      walletPermissionGrant: grant,
      dependencies,
      status: 'dependencies_pending',
    };
    if (delegation) {
      update.delegation = delegation;
    }
    await this.model.updateOne({ installationId }, { $set: update });
  }

  async updateDependencies(
    installationId: string,
    dependencies: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.model.updateOne({ installationId }, { $set: { dependencies } });
  }

  async lockInstallation(installationId: string, lockReason: string): Promise<boolean> {
    const result = await this.model.updateOne(
      {
        installationId,
        $or: [{ 'runtime.lockedAt': null }, { 'runtime.lockedAt': { $exists: false } }],
      },
      { $set: { 'runtime.lockedAt': new Date(), 'runtime.lockReason': lockReason } },
    );
    return result.modifiedCount > 0;
  }

  async unlockInstallation(installationId: string): Promise<void> {
    await this.model.updateOne(
      { installationId },
      { $set: { 'runtime.lockedAt': null, 'runtime.lockReason': null } },
    );
  }

  async recordFailure(installationId: string, error: string): Promise<void> {
    await this.model.updateOne(
      { installationId },
      {
        $inc: { 'runtime.failureCount': 1 },
        $set: { 'runtime.lastError': error },
      },
    );
  }

  async updateNextRunAt(
    installationId: string,
    nextRunAt: Date | null,
    lastRunAt?: Date,
  ): Promise<void> {
    const update: Record<string, unknown> = { 'schedule.nextRunAt': nextRunAt };
    if (lastRunAt) {
      update['schedule.lastRunAt'] = lastRunAt;
    }
    await this.model.updateOne({ installationId }, { $set: update });
  }

  async findDueInstallations(now: Date): Promise<SkillInstallationDoc[]> {
    return this.model
      .find({
        status: 'active',
        $and: [
          {
            $or: [
              { 'schedule.nextRunAt': { $lte: now } },
              { 'schedule.nextRunAt': { $exists: false } },
            ],
          },
          {
            $or: [{ 'runtime.lockedAt': null }, { 'runtime.lockedAt': { $exists: false } }],
          },
        ],
      })
      .exec();
  }

  async listForUser(userAddress: string): Promise<SkillInstallationDoc[]> {
    return this.model
      .find({ userAddress: { $regex: new RegExp(`^${userAddress}$`, 'i') } })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getByInstallationId(installationId: string): Promise<SkillInstallationDoc> {
    const doc = await this.model.findOne({ installationId }).exec();
    if (!doc) {
      throw AppError.notFound(`installation ${installationId}`);
    }
    return doc;
  }

  async pause(installationId: string): Promise<SkillInstallationDoc> {
    const doc = await this.getByInstallationId(installationId);
    doc.status = 'paused';
    await doc.save();
    return doc;
  }

  async revoke(installationId: string): Promise<SkillInstallationDoc> {
    const doc = await this.getByInstallationId(installationId);
    doc.status = 'revoked';
    await doc.save();
    return doc;
  }

  listTokens(chainId: number) {
    return listTokensForChain(chainId);
  }

  listDex(chainId: number) {
    return listDexForChain(chainId);
  }

  findRouter(chainId: number, name: 'uniswap-v3') {
    return findDexRouter(chainId, name);
  }

  private resolvePaymentToken(chainId: number): Address {
    const override =
      (this.config?.get?.('ONESHOT_PAYMENT_TOKEN_ADDRESS') as string | undefined) ?? undefined;
    return (override ||
      DEFAULT_PAYMENT_TOKEN_BY_CHAIN[chainId] ||
      '0x0000000000000000000000000000000000000000') as Address;
  }

  private async fetchFeeData(
    chainId: number,
    paymentToken: Address,
    messagePrefix: string,
  ): Promise<OneShotFeeData> {
    try {
      return await this.relayer.getFeeData({ chainId, paymentToken });
    } catch (err) {
      throw new AppError(
        ErrorCode.RELAYER_RPC_ERROR,
        502,
        `${messagePrefix} for chainId ${chainId}: ${(err as Error).message}`,
      );
    }
  }

  private deriveFeeAmount(chainId: number, paymentToken: Address, feeData: OneShotFeeData): bigint {
    const paymentTokenMeta = findToken(chainId, paymentToken);
    const minFee = (feeData as unknown as { minFee?: string }).minFee;
    return minFee
      ? parseUnits(minFee, paymentTokenMeta?.decimals ?? 6)
      : BigInt(feeData.requiredPaymentAmount ?? '10000');
  }

  private resolveAdapterKind(
    skill: SkillDefinitionDoc,
    legacySkillType?: string,
  ): SkillAdapterKind {
    const adapter = (skill.adapter ?? skill.executionMode) as SkillAdapterKind | undefined;
    if (!adapter) {
      throw AppError.notConfigured(`skill=${skill.skillId}`, 'skill adapter metadata missing');
    }
    if (legacySkillType && legacySkillType !== adapter) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `skillType ${legacySkillType} does not match skill adapter ${adapter}`,
      );
    }
    return adapter;
  }

  private lockConfigToSmartAccount(config: SkillConfig, smartAccountAddress: string): SkillConfig {
    if (config.type === 'direct-router-dca') {
      return {
        ...config,
        recipient: smartAccountAddress as Address,
      };
    }
    return config;
  }

  private buildAllowedTargets(
    chainId: number,
    previewCalls: PreparedExecutionCall[],
    labels: Record<string, string> | undefined,
  ): Array<{ address: Address; label: string }> {
    const targetSet = new Set<Address>();
    for (const call of previewCalls) targetSet.add(call.target);
    return Array.from(targetSet).map((address) => ({
      address,
      label: labels?.[address] ?? findToken(chainId, address)?.symbol ?? 'allowed target',
    }));
  }

  private buildAllowedSelectors(
    previewCalls: PreparedExecutionCall[],
    labels: Record<string, string> | undefined,
  ): Array<{ selector: HexString; label: string }> {
    const selectorSet = new Set<HexString>();
    for (const call of previewCalls) {
      const selector = (
        call.callData.length >= 10 ? call.callData.slice(0, 10) : '0x00000000'
      ) as HexString;
      selectorSet.add(selector);
    }
    return Array.from(selectorSet).map((selector) => ({
      selector,
      label:
        labels?.[selector] ??
        (selector === '0xa9059cbb'
          ? 'transfer(address,uint256)'
          : selector === '0x095ea7b3'
            ? 'approve(address,uint256)'
            : selector === '0x04e45aaf'
              ? 'exactInputSingle((...))'
              : selector === '0x00000000'
                ? 'self-call probe selector 0x00000000'
                : 'unknown'),
    }));
  }

  private assertConfigLocksSmartAccount(config: SkillConfig, smartAccountAddress: string): void {
    if ('recipient' in config && typeof config.recipient === 'string') {
      if (config.recipient.toLowerCase() !== smartAccountAddress.toLowerCase()) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'prepareSnapshot.configSnapshot.recipient is not locked to smartAccountAddress',
        );
      }
    }
  }

  private readAddress(config: SkillConfig, key: 'tokenIn' | 'tokenOut'): Address | undefined {
    if (config.type !== 'direct-router-dca') {
      return undefined;
    }
    return config[key].address as Address;
  }

  private readAmountPerRun(config: SkillConfig): string | undefined {
    return config.type === 'direct-router-dca' ? config.amountPerRun : undefined;
  }

  private computeNextRunAt(frequency: Frequency, now: Date): Date {
    const day = 24 * 60 * 60 * 1000;
    if (frequency === 'daily') return new Date(now.getTime() + day);
    if (frequency === 'weekly') return new Date(now.getTime() + 7 * day);
    return new Date(now.getTime() + 30 * day);
  }

  private deriveMaxRunsPerWeek(frequency: Frequency): number {
    if (frequency === 'daily') return 7;
    if (frequency === 'weekly') return 1;
    return 1;
  }
}
