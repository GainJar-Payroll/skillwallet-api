import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PermissionManifest,
  PermissionManifestDocument,
} from './schemas/permission-manifest.schema';
import {
  WalletPermissionRequestRecord,
  WalletPermissionRequestDocument,
} from './schemas/wallet-permission-request.schema';
import {
  WalletPermissionGrantRecord,
  WalletPermissionGrantDocument,
} from './schemas/wallet-permission-grant.schema';
import { DelegationRecord, DelegationRecordDocument } from './schemas/delegation-record.schema';
import {
  SkillInstallation,
  SkillInstallationDocument,
} from '../installations/schemas/skill-installation.schema';
import {
  SkillDefinition,
  SkillDefinitionDocument,
} from '../skills/schemas/skill-definition.schema';
import {
  ExecutorRegistry,
  ExecutorRegistryDocument,
} from '../executors/schemas/executor-registry.schema';
import {
  PermissionCompilerService,
  DcaCompileInput,
  AerodromeVoteCompileInput,
} from './permission-compiler.service';
import { InstallationsService } from '../installations/installations.service';
import {
  PreparePermissionRequestDto,
  SubmitPermissionGrantDto,
} from './dto/prepare-permission-request.dto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { sha256Hex } from '../common/utils/hash';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectModel(PermissionManifest.name)
    private readonly manifestModel: Model<PermissionManifestDocument>,
    @InjectModel(WalletPermissionRequestRecord.name)
    private readonly requestModel: Model<WalletPermissionRequestDocument>,
    @InjectModel(WalletPermissionGrantRecord.name)
    private readonly grantModel: Model<WalletPermissionGrantDocument>,
    @InjectModel(DelegationRecord.name)
    private readonly delegationModel: Model<DelegationRecordDocument>,
    @InjectModel(SkillInstallation.name)
    private readonly installationModel: Model<SkillInstallationDocument>,
    @InjectModel(SkillDefinition.name)
    private readonly skillModel: Model<SkillDefinitionDocument>,
    @InjectModel(ExecutorRegistry.name)
    private readonly executorModel: Model<ExecutorRegistryDocument>,
    private readonly compiler: PermissionCompilerService,
    private readonly installations: InstallationsService,
  ) {}

  async prepareRequest(input: PreparePermissionRequestDto): Promise<{
    installation: SkillInstallation;
    permissionManifest: PermissionManifest;
    walletPermissionRequest: WalletPermissionRequestRecord;
  }> {
    const skill = await this.skillModel.findOne({ skillId: input.skillId }).lean();
    if (!skill) {
      throw new AppError(ErrorCode.NOT_FOUND, `Skill not found: ${input.skillId}`);
    }
    if (!skill.supportedChains.includes(input.chainId)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Chain ${input.chainId} not supported for skill ${input.skillId}`,
      );
    }
    if (skill.status === 'disabled' || skill.status === 'coming-soon') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Skill ${input.skillId} is not available for installation (status: ${skill.status})`,
      );
    }
    if (input.config.type !== skill.adapter) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Config type ${input.config.type} does not match skill adapter ${skill.adapter}`,
      );
    }

    const executor = await this.executorModel
      .findOne({ chainId: input.chainId, status: 'active' })
      .lean();
    if (!executor) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        `No active executor registered for chainId=${input.chainId}. MVP 1: one executor per chain.`,
      );
    }

    const compiled =
      input.config.type === 'dca'
        ? this.compiler.compileDca({
            skillId: input.skillId,
            chainId: input.chainId,
            userAddress: input.userAddress as `0x${string}`,
            smartAccountAddress: input.smartAccountAddress as `0x${string}`,
            executorAddress: executor.executorAddress as `0x${string}`,
            config: input.config as DcaCompileInput['config'],
            durationDays: input.pricingPlan.durationDays,
          })
        : this.compiler.compileAerodromeVote({
            skillId: input.skillId,
            chainId: input.chainId,
            userAddress: input.userAddress as `0x${string}`,
            smartAccountAddress: input.smartAccountAddress as `0x${string}`,
            executorAddress: executor.executorAddress as `0x${string}`,
            config: input.config as AerodromeVoteCompileInput['config'],
            durationDays: input.pricingPlan.durationDays,
          });

    const persistedManifest = await this.manifestModel.create({
      ...compiled.manifest,
      manifestHash: compiled.manifestHash,
    });
    const persistedRequest = await this.requestModel.create({
      ...compiled.walletRequest,
      compiledFromManifestHash: compiled.manifestHash,
      requestHash: compiled.requestHash,
      status: 'prepared',
      requestedAt: new Date(),
    });

    const installation = await this.installations.createDraft(input, executor.executorAddress, {
      manifestId: persistedManifest.manifestId,
      manifestHash: compiled.manifestHash,
      title: persistedManifest.title,
      summary: persistedManifest.summary,
      allowedActions: persistedManifest.allowedActions,
      forbiddenActions: persistedManifest.forbiddenActions,
      allowedTargets: persistedManifest.allowedTargets,
      allowedSelectors: persistedManifest.allowedSelectors,
      allowedTokens: persistedManifest.allowedTokens,
      rules: persistedManifest.rules,
      validUntil: persistedManifest.validUntil,
    });

    await this.installations.setPermissionRequest(
      installation.installationId,
      persistedRequest.toObject() as unknown as Record<string, unknown>,
    );

    return {
      installation: await this.installations.findById(installation.installationId),
      permissionManifest: persistedManifest.toObject() as PermissionManifest,
      walletPermissionRequest: persistedRequest.toObject() as WalletPermissionRequestRecord,
    };
  }

  async submitGrant(input: SubmitPermissionGrantDto): Promise<{
    installation: SkillInstallation;
    grant: WalletPermissionGrantRecord;
    delegation?: DelegationRecord;
  }> {
    const installation = await this.installationModel.findOne({
      installationId: input.installationId,
    });
    if (!installation) {
      throw new AppError(ErrorCode.NOT_FOUND, `Installation not found: ${input.installationId}`);
    }
    if (installation.status !== 'pending_permission') {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        `Installation is not in pending_permission status (current: ${installation.status})`,
      );
    }

    if (!input.context && !input.delegationManager) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Either context or delegationManager must be provided in the grant',
      );
    }
    if (!input.expiresAt) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'expiresAt must be provided in the grant');
    }
    if (!input.normalizedPermissions || input.normalizedPermissions.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'normalizedPermissions must be provided in the grant',
      );
    }

    const grantedAt = new Date();
    const expiresAt = new Date(input.expiresAt);
    const rawResponse = input.rawGrantResponse as Record<string, unknown>;
    const responseHash = sha256Hex(rawResponse ?? {});

    const grant = await this.grantModel.create({
      standard: 'erc7715',
      status: 'granted',
      grantedAt,
      expiresAt,
      delegationManager: input.delegationManager,
      context: input.context,
      dependencies: input.dependencies,
      rawResponse: rawResponse ?? {},
      responseHash,
      normalizedPermissions: input.normalizedPermissions,
    });

    let delegation: DelegationRecord | undefined;
    if (input.context && input.delegationManager) {
      const delegationRecord = await this.delegationModel.create({
        standard: 'erc7710',
        status: 'redeemable',
        delegator: installation.smartAccountAddressNormalized,
        delegate: installation.executorAddressNormalized,
        delegationManager: input.delegationManager,
        permissionContext: input.context,
        rawDelegation: rawResponse ?? {},
        caveats: (input.dependencies ?? []).map((dep) => ({
          kind: 'custom',
          enforcer: dep.factory,
          terms: dep.factoryData,
        })),
        grantedAt,
        expiresAt,
      });
      delegation = delegationRecord.toObject() as DelegationRecord;
    }

    await this.installations.setPermissionGrant(
      installation.installationId,
      grant.toObject() as unknown as Record<string, unknown>,
      delegation as unknown as Record<string, unknown> | undefined,
    );
    await this.installations.updateStatus(installation.installationId, { status: 'active' });

    const refreshed = await this.installations.findById(installation.installationId);
    return {
      installation: refreshed,
      grant: grant.toObject() as WalletPermissionGrantRecord,
      delegation,
    };
  }
}
