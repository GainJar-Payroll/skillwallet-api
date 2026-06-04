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
  WalletPermissionResponseItem,
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
import { PermissionSupportCheckerService } from './permission-support-checker.service';
import { InstallationsService } from '../installations/installations.service';
import {
  CheckSupportDto,
  PreparePermissionRequestDto,
  SubmitPermissionGrantDto,
  ReportDependenciesDto,
  RevokePermissionDto,
} from './dto/prepare-permission-request.dto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { sha256Hex } from '../common/utils/hash';
import { normalizeAddress } from '../common/utils/address';
import { toChainIdHex } from '../common/utils/chain';
import { isTokenAllowed } from '../chains/chain-token-registry';

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
    private readonly supportChecker: PermissionSupportCheckerService,
    private readonly installations: InstallationsService,
  ) {}

  async checkSupport(input: CheckSupportDto) {
    return this.supportChecker.checkSupport(input);
  }

  async prepareRequest(input: PreparePermissionRequestDto): Promise<{
    installation: SkillInstallation;
    permissionManifest: PermissionManifest;
    walletPermissionRequest: WalletPermissionRequestRecord;
    permissionRequests: Array<Record<string, unknown>>;
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

    if (input.config.type === 'dca') {
      const { tokenIn, tokenOut, allowCustomToken } = input.config;
      if (normalizeAddress(tokenIn.address) === normalizeAddress(tokenOut.address)) {
        throw new AppError(
          ErrorCode.SELF_SWAP_REJECTED,
          `tokenIn and tokenOut must be different (got ${tokenIn.address})`,
        );
      }
      if (!allowCustomToken) {
        if (!isTokenAllowed(input.chainId, tokenIn.address)) {
          throw new AppError(
            ErrorCode.TOKEN_NOT_ALLOWED,
            `tokenIn ${tokenIn.address} is not in the allowlist for chainId=${input.chainId}. Set allowCustomToken=true to opt out.`,
          );
        }
        if (!isTokenAllowed(input.chainId, tokenOut.address)) {
          throw new AppError(
            ErrorCode.TOKEN_NOT_ALLOWED,
            `tokenOut ${tokenOut.address} is not in the allowlist for chainId=${input.chainId}. Set allowCustomToken=true to opt out.`,
          );
        }
      }
    }

    const executor = await this.executorModel
      .findOne({ chainId: input.chainId, status: 'active' })
      .lean();
    if (!executor) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        `No active executor registered for chainId=${input.chainId}.`,
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

    const rawRequest = compiled.walletRequest.rawRequest as Record<string, unknown>;
    const permissionRequests: Array<Record<string, unknown>> = [
      {
        chainId: toChainIdHex(input.chainId),
        from: input.smartAccountAddress,
        to: executor.executorAddress,
        permission: rawRequest.permission,
        rules: rawRequest.rules ?? [],
      },
    ];

    return {
      installation: await this.installations.findById(installation.installationId),
      permissionManifest: persistedManifest.toObject() as PermissionManifest,
      walletPermissionRequest: persistedRequest.toObject() as WalletPermissionRequestRecord,
      permissionRequests,
    };
  }

  async submitGrant(input: SubmitPermissionGrantDto): Promise<{
    installation: SkillInstallation;
    grant: WalletPermissionGrantRecord;
    delegations: DelegationRecord[];
    activation: 'active' | 'dependencies_pending' | 'permission_granted';
  }> {
    const installation = await this.installationModel.findOne({
      installationId: input.installationId,
    });
    if (!installation) {
      throw new AppError(ErrorCode.NOT_FOUND, `Installation not found: ${input.installationId}`);
    }
    if (installation.status !== 'pending_permission' && installation.status !== 'support_checked') {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        `Installation is not awaiting permission grant (current: ${installation.status})`,
      );
    }

    const requestRecord = installation.walletPermissionRequest as
      | { requestId?: string; rawRequest?: Record<string, unknown> }
      | undefined;
    if (!requestRecord?.rawRequest) {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        'Installation is missing the prepared walletPermissionRequest',
      );
    }
    const requestedPermission = (requestRecord.rawRequest.permission ?? {}) as Record<
      string,
      unknown
    >;
    const requestedType = String(requestedPermission.type ?? '');

    for (const response of input.permissionResponses) {
      const responseType = String((response.permission as { type?: string })?.type ?? '');
      if (responseType !== requestedType) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `PermissionResponse type "${responseType}" does not match requested type "${requestedType}"`,
        );
      }
      const responseChainId = Number(response.chainId);
      if (responseChainId !== installation.chainId) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `PermissionResponse chainId ${responseChainId} does not match installation chainId ${installation.chainId}`,
        );
      }
      const responseFrom = response.from ? normalizeAddress(response.from) : undefined;
      if (responseFrom && responseFrom !== installation.smartAccountAddressNormalized) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `PermissionResponse.from ${responseFrom} does not match smartAccount ${installation.smartAccountAddressNormalized}`,
        );
      }
      if (!response.context || !response.delegationManager) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Each PermissionResponse must include non-empty context and delegationManager',
        );
      }
    }

    this.verifyAttenuation(requestedPermission, input.permissionResponses, installation);

    const grantedAt = new Date();
    const expiresAt = this.computeExpiresAt(input.permissionResponses, installation);

    const responseItems: WalletPermissionResponseItem[] = input.permissionResponses.map(
      (response) => {
        const responseHash = sha256Hex({
          chainId: response.chainId,
          context: response.context,
          delegationManager: response.delegationManager,
          permission: response.permission,
        });
        return {
          chainId: Number(response.chainId),
          chainIdHex: toChainIdHex(Number(response.chainId)),
          from: response.from,
          to: response.to,
          permission: response.permission,
          rules: response.rules ?? [],
          context: response.context,
          delegationManager: response.delegationManager,
          dependencies: response.dependencies ?? [],
          responseHash,
        };
      },
    );

    const rawResponse = (input.rawGrantResponse ?? input.permissionResponses) as Record<
      string,
      unknown
    >;
    const responseHash = sha256Hex(rawResponse);

    const grant = await this.grantModel.create({
      standard: 'erc7715',
      status: 'granted',
      grantedAt,
      ...(expiresAt ? { expiresAt } : {}),
      responses: responseItems,
      rawResponse,
      responseHash,
    });

    const delegations: DelegationRecord[] = [];
    for (const item of responseItems) {
      const delegation = await this.delegationModel.create({
        standard: 'erc7710',
        status: 'redeemable',
        delegator: installation.smartAccountAddressNormalized,
        delegate: installation.executorAddressNormalized,
        delegationManager: item.delegationManager,
        permissionContext: item.context,
        rawPermissionResponse: rawResponse,
        caveats: (item.dependencies ?? []).map((dep) => ({
          kind: 'dependency',
          enforcer: dep.factory,
          terms: dep.factoryData,
        })),
        grantedAt,
        expiresAt: expiresAt ?? undefined,
      });
      delegations.push(delegation.toObject() as DelegationRecord);
    }

    const dependencyEntries = this.flattenDependencies(input.permissionResponses);
    let activation: 'active' | 'dependencies_pending' | 'permission_granted';
    if (dependencyEntries.length === 0) {
      await this.installations.setPermissionGrantAndActivate(
        installation.installationId,
        grant.toObject() as unknown as Record<string, unknown>,
        delegations[0] as unknown as Record<string, unknown> | undefined,
      );
      activation = 'active';
    } else {
      await this.installations.setPermissionGrantDependencies(
        installation.installationId,
        grant.toObject() as unknown as Record<string, unknown>,
        delegations[0] as unknown as Record<string, unknown> | undefined,
        dependencyEntries,
      );
      activation = 'dependencies_pending';
    }

    return {
      installation: await this.installations.findById(installation.installationId),
      grant: grant.toObject() as WalletPermissionGrantRecord,
      delegations,
      activation,
    };
  }

  async reportDependencies(input: ReportDependenciesDto): Promise<{
    installation: SkillInstallation;
    allDeployed: boolean;
  }> {
    const installation = await this.installationModel.findOne({
      installationId: input.installationId,
    });
    if (!installation) {
      throw new AppError(ErrorCode.NOT_FOUND, `Installation not found: ${input.installationId}`);
    }
    if (installation.status !== 'dependencies_pending') {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        `Installation is not awaiting dependencies (current: ${installation.status})`,
      );
    }

    await this.installations.updateDependencies(installation.installationId, input.dependencies);
    const refreshed = await this.installations.findById(installation.installationId);
    const allDeployed = (refreshed.dependencies ?? []).every(
      (dep) => dep.status === 'deployed' || dep.status === 'not_required',
    );
    if (allDeployed) {
      await this.installations.updateStatus(installation.installationId, { status: 'active' });
    }
    return {
      installation: await this.installations.findById(installation.installationId),
      allDeployed,
    };
  }

  async revoke(input: RevokePermissionDto): Promise<{
    installation: SkillInstallation;
    grant?: WalletPermissionGrantRecord;
  }> {
    const installation = await this.installationModel.findOne({
      installationId: input.installationId,
    });
    if (!installation) {
      throw new AppError(ErrorCode.NOT_FOUND, `Installation not found: ${input.installationId}`);
    }
    if (installation.status === 'revoked') {
      return { installation: installation.toObject() as SkillInstallation };
    }

    const now = new Date();
    await this.installationModel.updateOne(
      { installationId: installation.installationId },
      { $set: { status: 'revoked', revokedAt: now } },
    );
    const grantRecord = installation.walletPermissionGrant as { responseHash?: string } | undefined;
    let grantDoc: WalletPermissionGrantRecord | undefined;
    if (grantRecord?.responseHash) {
      const updated = await this.grantModel.findOneAndUpdate(
        { responseHash: grantRecord.responseHash },
        { $set: { status: 'revoked', revokedAt: now } },
        { new: true },
      );
      grantDoc = updated ? (updated.toObject() as WalletPermissionGrantRecord) : undefined;
    }
    await this.delegationModel.updateMany(
      { delegator: installation.smartAccountAddressNormalized, status: 'redeemable' },
      { $set: { status: 'revoked', revokedAt: now } },
    );
    return {
      installation: await this.installations.findById(installation.installationId),
      grant: grantDoc,
    };
  }

  async getGranted(installationId: string): Promise<{
    installation: SkillInstallation;
    grant?: WalletPermissionGrantRecord;
    delegation?: DelegationRecord;
  }> {
    const installation = await this.installations.findById(installationId);
    const grantRecord = installation.walletPermissionGrant as { responseHash?: string } | undefined;
    let grantDoc: WalletPermissionGrantRecord | undefined;
    let delegationDoc: DelegationRecord | undefined;
    if (grantRecord?.responseHash) {
      const g = await this.grantModel.findOne({
        responseHash: grantRecord.responseHash,
      });
      grantDoc = g ? (g.toObject() as WalletPermissionGrantRecord) : undefined;
      const d = await this.delegationModel.findOne({
        delegator: installation.smartAccountAddressNormalized,
        status: { $in: ['redeemable', 'revoked', 'expired'] },
      });
      delegationDoc = d ? (d.toObject() as DelegationRecord) : undefined;
    }
    return { installation, grant: grantDoc, delegation: delegationDoc };
  }

  private verifyAttenuation(
    requestedPermission: Record<string, unknown>,
    responses: Array<{ permission: Record<string, unknown>; isAdjustmentAllowed?: boolean }>,
    installation: SkillInstallation,
  ): void {
    const type = String(requestedPermission.type ?? '');
    if (type !== 'erc20-token-periodic') {
      return;
    }
    const requestedData = (requestedPermission.data ?? {}) as Record<string, unknown>;
    const requestedAmount = BigInt(String(requestedData.periodAmount ?? '0'));
    const requestedDuration = Number(requestedData.periodDuration ?? 0);

    for (const response of responses) {
      const responsePermission = (response.permission ?? {}) as Record<string, unknown>;
      if (responsePermission.isAdjustmentAllowed === true) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'PermissionResponse.permission.isAdjustmentAllowed=true is not accepted; backend never broadens user grants',
        );
      }
      const responseData = (responsePermission.data ?? {}) as Record<string, unknown>;
      const grantedAmount = BigInt(String(responseData.periodAmount ?? '0'));
      const grantedDuration = Number(responseData.periodDuration ?? 0);
      if (grantedAmount > requestedAmount) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `PermissionResponse periodAmount ${grantedAmount} exceeds requested ${requestedAmount} for installation ${installation.installationId}`,
        );
      }
      if (grantedDuration > 0 && requestedDuration > 0 && grantedDuration > requestedDuration) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `PermissionResponse periodDuration ${grantedDuration} exceeds requested ${requestedDuration}`,
        );
      }
    }
  }

  private computeExpiresAt(
    responses: Array<{ permission: Record<string, unknown> }>,
    installation: SkillInstallation,
  ): Date | null {
    const manifest = installation.permissionManifest as { validUntil?: Date | string };
    if (manifest?.validUntil) {
      return new Date(manifest.validUntil);
    }
    for (const response of responses) {
      const expiry = (response.permission as { expiry?: number | string }).expiry;
      if (expiry) {
        return new Date(Number(expiry) * 1000);
      }
    }
    return null;
  }

  private flattenDependencies(
    responses: Array<{
      chainId: number | string;
      dependencies?: Array<{ factory?: string; factoryData?: string }>;
    }>,
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const response of responses) {
      for (const dep of response.dependencies ?? []) {
        result.push({
          chainId: Number(response.chainId),
          factory: dep.factory,
          factoryData: dep.factoryData,
          status: 'pending',
        });
      }
    }
    return result;
  }
}
