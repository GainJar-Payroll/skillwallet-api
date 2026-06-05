import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PermissionManifestDoc } from '../../common/permissions/permission-manifest.schema';

export interface PolicyCheckInput {
  chainId: number;
  userAddress: string;
  manifest?: PermissionManifestDoc | null;
  execution: {
    description: string;
    actions: Array<{ target: string; value: string; callData: string }>;
  };
}

export interface PolicyVerdict {
  allowed: boolean;
  reason: string;
  blockedBy?: string;
}

export class PolicyValidatorService {
  evaluate(input: PolicyCheckInput): PolicyVerdict {
    if (input.execution.actions.length === 0) {
      return { allowed: false, reason: 'execution has no actions', blockedBy: 'no-actions' };
    }
    for (const action of input.execution.actions) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(action.target)) {
        return {
          allowed: false,
          reason: `action target is not a 20-byte address: ${action.target}`,
          blockedBy: 'bad-target',
        };
      }
      if (action.value !== '0x0' && action.value !== '0x') {
        return {
          allowed: false,
          reason: 'native value transfers are not permitted in MVP',
          blockedBy: 'no-native-value',
        };
      }
    }

    const manifest = input.manifest;
    if (!manifest) {
      return { allowed: true, reason: 'no manifest attached; default structural check passed' };
    }
    if (manifest.status === 'rejected' || manifest.status === 'expired') {
      return {
        allowed: false,
        reason: `manifest status is ${manifest.status}`,
        blockedBy: `manifest.${manifest.status}`,
      };
    }
    for (const rule of manifest.rules) {
      const verdict = evaluateRule(rule, input);
      if (!verdict.allowed) return verdict;
    }
    return { allowed: true, reason: 'all manifest rules passed' };
  }

  validate(
    installation: { chainId: number; userAddress: string; status?: string },
    proposedAction: { target: string; value: string; calldata: string },
    _policy: unknown,
  ): { ok: boolean; blockedReason?: string } {
    const verdict = this.evaluate({
      chainId: installation.chainId,
      userAddress: installation.userAddress,
      execution: {
        description: 'compat validation',
        actions: [
          {
            target: proposedAction.target,
            value: proposedAction.value,
            callData: proposedAction.calldata,
          },
        ],
      },
    });
    return verdict.allowed ? { ok: true } : { ok: false, blockedReason: verdict.reason };
  }
}

type ManifestRule = PermissionManifestDoc['rules'][number];

function evaluateRule(rule: ManifestRule, input: PolicyCheckInput): PolicyVerdict {
  switch (rule.enforcement) {
    case 'allow-target': {
      const allowed = (rule.value.targets ?? []).map((t) => t.toLowerCase());
      const offending = input.execution.actions.find(
        (a) => !allowed.includes(a.target.toLowerCase()),
      );
      if (offending) {
        return {
          allowed: false,
          reason: `target ${offending.target} not in allow-target list`,
          blockedBy: rule.id,
        };
      }
      return { allowed: true, reason: `allow-target ${rule.id} passed` };
    }

    case 'deny-target': {
      const denied = (rule.value.targets ?? []).map((t) => t.toLowerCase());
      const offending = input.execution.actions.find((a) =>
        denied.includes(a.target.toLowerCase()),
      );
      if (offending) {
        return {
          allowed: false,
          reason: `target ${offending.target} is in deny-target list`,
          blockedBy: rule.id,
        };
      }
      return { allowed: true, reason: `deny-target ${rule.id} passed` };
    }

    case 'deny-selector': {
      const deniedSelectors = (rule.value.selectors ?? []).map((s) => s.toLowerCase());
      const offending = input.execution.actions.find((a) => {
        const selector = (a.callData.slice(0, 10) || '0x').toLowerCase();
        return deniedSelectors.includes(selector);
      });
      if (offending) {
        return {
          allowed: false,
          reason: `selector ${offending.callData.slice(0, 10)} is in deny-selector list`,
          blockedBy: rule.id,
        };
      }
      return { allowed: true, reason: `deny-selector ${rule.id} passed` };
    }

    case 'erc20-periodic-spend':
      return {
        allowed: true,
        reason: 'erc20-periodic-spend enforced at scheduling layer, not here',
      };

    case 'require-allow-target-or-deny-target':
      return { allowed: true, reason: 'structural rule only; no runtime check' };

    default: {
      const unknown = (rule as { enforcement: string }).enforcement;
      throw new AppError(
        ErrorCode.POLICY_RULE_UNKNOWN,
        500,
        `Unknown rule enforcement: ${unknown}`,
      );
    }
  }
}
