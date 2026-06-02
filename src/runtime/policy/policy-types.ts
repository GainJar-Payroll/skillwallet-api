export type Enforcement = 'wallet-permission' | 'onchain-caveat' | 'backend-policy' | 'ui-warning';

export type PermissionRuleSource = 'erc7715' | 'erc7710' | 'skillwallet';

export type PermissionRuleKind =
  | 'erc20-periodic-spend'
  | 'allowed-target'
  | 'allowed-selector'
  | 'fixed-token-in'
  | 'fixed-token-out'
  | 'fixed-recipient'
  | 'max-slippage'
  | 'expiry'
  | 'max-executions-per-period'
  | 'no-unlimited-approval'
  | 'custom';

export interface PolicyRule {
  id: string;
  label: string;
  description?: string;
  enforcement: Enforcement;
  source: PermissionRuleSource;
  kind: PermissionRuleKind;
  data: Record<string, unknown>;
}

export interface PolicyManifest {
  allowedTargets: string[];
  allowedSelectors: string[];
  allowedTokens: string[];
  rules: PolicyRule[];
  validUntil?: string | Date;
}

export interface CheckedRule {
  ruleId: string;
  ok: boolean;
  message: string;
  enforcement: Enforcement;
}

export interface PolicyValidationResult {
  ok: boolean;
  blockedReason?: string;
  checkedRules: CheckedRule[];
  warnings?: string[];
}
