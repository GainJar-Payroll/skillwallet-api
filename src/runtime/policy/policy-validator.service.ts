import { Injectable } from '@nestjs/common';
import { ProposedAction } from '../schemas/execution-attempt.schema';
import { Enforcement, PolicyManifest, PolicyRule, PolicyValidationResult, CheckedRule } from './policy-types';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { SkillInstallation } from '../../installations/schemas/skill-installation.schema';

@Injectable()
export class PolicyValidatorService {
  validate(installation: SkillInstallation, action: ProposedAction, manifest: PolicyManifest): PolicyValidationResult {
    const checkedRules: CheckedRule[] = [];
    const warnings: string[] = [];

    if (installation.chainId !== action.chainId) {
      checkedRules.push({
        ruleId: 'rule.chain-match',
        ok: false,
        message: `Action chainId ${action.chainId} does not match installation chainId ${installation.chainId}`,
        enforcement: 'backend-policy',
      });
      return { ok: false, blockedReason: 'chainId mismatch', checkedRules };
    }

    if (installation.status !== 'active') {
      checkedRules.push({
        ruleId: 'rule.installation-active',
        ok: false,
        message: `Installation is not active (status: ${installation.status})`,
        enforcement: 'backend-policy',
      });
      return { ok: false, blockedReason: 'installation not active', checkedRules };
    }

    if (manifest.validUntil) {
      const validUntil = new Date(manifest.validUntil);
      if (new Date() > validUntil) {
        checkedRules.push({
          ruleId: 'rule.expiry',
          ok: false,
          message: `Permission manifest expired at ${validUntil.toISOString()}`,
          enforcement: 'wallet-permission',
        });
        return { ok: false, blockedReason: 'manifest expired', checkedRules };
      }
    }

    if (manifest.allowedTargets.length > 0) {
      const targetLower = action.target.toLowerCase();
      const allowed = manifest.allowedTargets.some((t) => t.toLowerCase() === targetLower);
      checkedRules.push({
        ruleId: 'rule.allowed-target',
        ok: allowed,
        message: allowed ? 'Target is allowed' : `Target ${action.target} not in allowedTargets`,
        enforcement: 'backend-policy',
      });
      if (!allowed) {
        return { ok: false, blockedReason: 'target not allowed', checkedRules };
      }
    }

    if (manifest.allowedSelectors.length > 0) {
      const selectorMatch = action.calldata.toLowerCase().startsWith(action.selector.toLowerCase());
      if (selectorMatch) {
        const allowed = manifest.allowedSelectors.some((s) => s.toLowerCase() === action.selector.toLowerCase());
        checkedRules.push({
          ruleId: 'rule.allowed-selector',
          ok: allowed,
          message: allowed ? 'Selector is allowed' : `Selector ${action.selector} not in allowedSelectors`,
          enforcement: 'backend-policy',
        });
        if (!allowed) {
          return { ok: false, blockedReason: 'selector not allowed', checkedRules };
        }
      }
    }

    if (action.decoded.actionType === 'transfer') {
      checkedRules.push({
        ruleId: 'rule.no-transfer',
        ok: false,
        message: 'Transfer actions are blocked by default policy',
        enforcement: 'backend-policy',
      });
      return { ok: false, blockedReason: 'transfer actions blocked', checkedRules };
    }

    if (action.decoded.actionType === 'approve') {
      const spender = (action.decoded as { spender?: string }).spender;
      const amount = action.value;
      if (!spender) {
        checkedRules.push({
          ruleId: 'rule.approve-spender-missing',
          ok: false,
          message: 'Approve action requires a spender',
          enforcement: 'backend-policy',
        });
        return { ok: false, blockedReason: 'approve spender missing', checkedRules };
      }
      if (amount === 'unlimited' || amount === '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') {
        checkedRules.push({
          ruleId: 'rule.no-unlimited-approval',
          ok: false,
          message: 'Unlimited token approvals are blocked by policy',
          enforcement: 'backend-policy',
        });
        return { ok: false, blockedReason: 'unlimited approval blocked', checkedRules };
      }
    }

    for (const rule of manifest.rules) {
      const result = this.checkRule(rule, action, installation);
      checkedRules.push(result);
      if (!result.ok && rule.enforcement !== 'ui-warning') {
        return { ok: false, blockedReason: result.message, checkedRules };
      }
      if (!result.ok && rule.enforcement === 'ui-warning') {
        warnings.push(result.message);
      }
    }

    return { ok: true, checkedRules, warnings: warnings.length > 0 ? warnings : undefined };
  }

  private checkRule(rule: PolicyRule, action: ProposedAction, installation: SkillInstallation): CheckedRule {
    const base = { ruleId: rule.id, enforcement: rule.enforcement } as const;

    switch (rule.kind) {
      case 'fixed-token-in': {
        const expected = (rule.data.token as string | undefined)?.toLowerCase();
        const actual = action.decoded.tokenIn?.toLowerCase();
        if (!actual) {
          return { ...base, ok: false, message: 'Action missing tokenIn' };
        }
        const ok = expected === actual;
        return { ...base, ok, message: ok ? 'tokenIn matches' : `tokenIn ${actual} != expected ${expected}` };
      }
      case 'fixed-token-out': {
        const expected = (rule.data.token as string | undefined)?.toLowerCase();
        const actual = action.decoded.tokenOut?.toLowerCase();
        if (!actual) {
          return { ...base, ok: false, message: 'Action missing tokenOut' };
        }
        const ok = expected === actual;
        return { ...base, ok, message: ok ? 'tokenOut matches' : `tokenOut ${actual} != expected ${expected}` };
      }
      case 'fixed-recipient': {
        const expected = (rule.data.recipient as string | undefined)?.toLowerCase();
        const actual = action.decoded.recipient?.toLowerCase();
        if (!actual) {
          return { ...base, ok: false, message: 'Action missing recipient' };
        }
        const ok = expected === actual;
        return { ...base, ok, message: ok ? 'recipient matches' : `recipient ${actual} != expected ${expected}` };
      }
      case 'max-slippage': {
        const maxBps = rule.data.maxSlippageBps as number;
        if (!action.decoded.minAmountOut || !action.decoded.amountIn) {
          return { ...base, ok: false, message: 'Cannot check slippage without amountIn/minAmountOut' };
        }
        return { ...base, ok: true, message: `maxSlippageBps=${maxBps} constraint present` };
      }
      case 'erc20-periodic-spend': {
        const periodAmount = rule.data.periodAmount as string | undefined;
        const actual = action.decoded.amountIn;
        if (!periodAmount) {
          return { ...base, ok: false, message: 'Rule missing periodAmount' };
        }
        const ok = actual ? BigInt(actual) <= BigInt(this.toBaseUnits(periodAmount, 6)) : false;
        return { ...base, ok, message: ok ? 'amountIn within period cap' : `amountIn ${actual} exceeds period cap ${periodAmount}` };
      }
      case 'no-unlimited-approval': {
        if (action.decoded.actionType === 'approve' && (action.value === 'unlimited' || (action.value && BigInt(action.value) > BigInt('1000000000000000000000000000')))) {
          return { ...base, ok: false, message: 'Unlimited approval blocked' };
        }
        return { ...base, ok: true, message: 'No unlimited approval' };
      }
      case 'allowed-target': {
        const expected = (rule.data.target as string | undefined)?.toLowerCase();
        const ok = expected === action.target.toLowerCase();
        return { ...base, ok, message: ok ? 'target allowed' : `target ${action.target} not allowed` };
      }
      default:
        return { ...base, ok: true, message: `Rule ${rule.kind} acknowledged (not enforced server-side)` };
    }
  }

  private toBaseUnits(amount: string, decimals: number): string {
    const [whole, fraction = ''] = amount.split('.');
    const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
    return `${whole}${padded}`.replace(/^0+/, '') || '0';
  }
}