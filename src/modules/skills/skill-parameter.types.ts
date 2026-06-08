export type SkillParameterType = 'select' | 'number' | 'boolean' | 'string' | 'address';

export interface SkillParameterBase {
  key: string;
  label: string;
  type: SkillParameterType;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
}

export interface SkillSelectOptionMetadata {
  address?: `0x${string}`;
  symbol?: string;
  decimals?: number;
  [key: string]: unknown;
}

/**
 * A trusted option for a select parameter.
 *
 * The frontend renders `label` and submits only `value`. Metadata is declared by
 * the backend skill definition and must not be replaced with arbitrary user
 * input. Token-like selects can expose `metadata.address` for display or
 * validation enrichment, while runtime-critical token routing should continue to
 * resolve from chain configuration where available.
 */
export interface SkillSelectOption {
  label: string;
  value: string;
  metadata?: SkillSelectOptionMetadata;
}

/**
 * Declarative runtime parameter contract for a skill.
 *
 * This schema is the source of truth shared by admin seed data, frontend install
 * forms, `/installations/prepare`, `/installations/confirm`, and skill runners.
 * The discriminated `type` selects both the UI control and backend validator.
 *
 * Canonical install input is `SkillParameterInput[]`, for example
 * `[{ key: 'outputToken', value: 'weth' }]`. The backend may normalize legacy
 * object payloads during migration, but persisted installation parameters remain
 * a normalized object keyed by parameter name for runner compatibility.
 *
 * Select parameters intentionally submit stable option values rather than raw
 * metadata. For example, a user submits `weth`; the backend checks it against
 * `options[].value` and can validate trusted `options[].metadata.address` with
 * `getAddress`. This prevents arbitrary token address injection while keeping
 * each skill flexible.
 */
export type SkillParameterDefinition =
  | SkillSelectParameterDefinition
  | SkillNumberParameterDefinition
  | SkillBooleanParameterDefinition
  | SkillStringParameterDefinition
  | SkillAddressParameterDefinition;

export interface SkillSelectParameterDefinition extends SkillParameterBase {
  type: 'select';
  options: Array<SkillSelectOption | string>;
  defaultValue?: string;
}

export interface SkillNumberParameterDefinition extends SkillParameterBase {
  type: 'number';
  defaultValue?: string | number;
  min?: string | number;
  max?: string | number;
  integer?: boolean;
}

export interface SkillBooleanParameterDefinition extends SkillParameterBase {
  type: 'boolean';
  defaultValue?: boolean;
}

export interface SkillStringParameterDefinition extends SkillParameterBase {
  type: 'string';
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface SkillAddressParameterDefinition extends SkillParameterBase {
  type: 'address';
  defaultValue?: `0x${string}`;
}

export interface SkillParameterInput {
  key: string;
  value: unknown;
}

export type SkillParameterInputPayload = SkillParameterInput[];
