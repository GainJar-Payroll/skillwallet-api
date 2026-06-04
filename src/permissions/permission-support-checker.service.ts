import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SkillDefinition,
  SkillDefinitionDocument,
} from '../skills/schemas/skill-definition.schema';
import {
  WalletSupportCheckRecord,
  WalletSupportCheckDocument,
  MatchedItem,
  MissingItem,
} from './schemas/wallet-support-check.schema';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { sha256Hex } from '../common/utils/hash';

export interface CheckSupportInput {
  userAddress: string;
  smartAccountAddress: string;
  skillId: string;
  chainId: number;
  walletReportedPermissions: string[];
}

export interface CheckSupportResult {
  checkId: string;
  check: WalletSupportCheckRecord;
  skill: SkillDefinition;
  matched: MatchedItem[];
  missing: MissingItem[];
  allSupported: boolean;
}

export interface ReportSupportInput {
  installationId: string;
  checkId: string;
  matched: Array<{ chainId: number; permissionType: string; isAdjustmentAllowed: boolean }>;
  missing: Array<{ chainId: number; permissionType: string; reason: string }>;
  reportedAt?: string;
}

@Injectable()
export class PermissionSupportCheckerService {
  constructor(
    @InjectModel(SkillDefinition.name)
    private readonly skillModel: Model<SkillDefinitionDocument>,
    @InjectModel(WalletSupportCheckRecord.name)
    private readonly checkModel: Model<WalletSupportCheckDocument>,
  ) {}

  async checkSupport(input: CheckSupportInput): Promise<CheckSupportResult> {
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

    const requirements = skill.permissionRequirements ?? [];
    const requirementsForChain = requirements.filter((r) => r.chainId === input.chainId);
    const reported = new Set(input.walletReportedPermissions);

    const matched: MatchedItem[] = [];
    const missing: MissingItem[] = [];

    for (const req of requirementsForChain) {
      if (reported.has(req.permissionType)) {
        matched.push({
          chainId: req.chainId,
          permissionType: req.permissionType,
          requiredRuleTypes: req.requiredRuleTypes,
          required: req.required ?? true,
        });
      } else {
        missing.push({
          chainId: req.chainId,
          permissionType: req.permissionType,
          requiredRuleTypes: req.requiredRuleTypes,
          reason: 'wallet_does_not_report_permission_type',
        });
      }
    }

    const checkId = `check_${sha256Hex({
      user: input.userAddress,
      sa: input.smartAccountAddress,
      skill: input.skillId,
      chain: input.chainId,
      reported: [...reported].sort(),
    }).slice(0, 32)}`;

    const check = await this.checkModel.create({
      checkId,
      userAddress: input.userAddress,
      smartAccountAddress: input.smartAccountAddress,
      skillId: input.skillId,
      chainId: input.chainId,
      walletReportedPermissions: input.walletReportedPermissions,
      matched,
      missing,
      checkedAt: new Date(),
    });

    return {
      checkId,
      check: check.toObject() as unknown as WalletSupportCheckRecord,
      skill,
      matched,
      missing,
      allSupported: missing.length === 0,
    };
  }

  async findByCheckId(checkId: string): Promise<WalletSupportCheckRecord> {
    const check = await this.checkModel.findOne({ checkId }).lean();
    if (!check) {
      throw new AppError(ErrorCode.NOT_FOUND, `Support check not found: ${checkId}`);
    }
    return check;
  }
}
