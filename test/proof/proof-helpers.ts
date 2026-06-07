/**
 * test/proof/proof-helpers.ts
 *
 * Shared helpers used by both `proof.ts` (admin-trigger DCA) and
 * `proof-trigger-dca.ts` (event-trigger DCA). These helpers exist to:
 *
 *   1. Detect an already-installed skill for a `(user, smartAccount, skillId)`
 *      triple BEFORE calling `/installations/prepare`, so a re-run does not
 *      send a duplicate prepare payload.
 *   2. Mirror the backend parameter validator (see
 *      `src/modules/skills/skill-parameter-validation.ts`) on the client side
 *      so a script fails fast with a clear error if its chosen values are
 *      typed wrong, are not in a `select.options[]` list, etc.
 *
 * The script is the source of truth for "what I am about to send the
 * backend". If the script constructs an invalid value, we want a local
 * failure rather than a 400 from the backend.
 */

import { getAddress, type Address } from 'viem';

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

export interface SkillSelectOption {
  label: string;
  value: string;
  metadata?: SkillSelectOptionMetadata;
}

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

export type SkillParameterDefinition =
  | SkillSelectParameterDefinition
  | SkillNumberParameterDefinition
  | SkillBooleanParameterDefinition
  | SkillStringParameterDefinition
  | SkillAddressParameterDefinition;

export interface SkillParameterInput {
  key: string;
  value: unknown;
}

/* -------------------------------------------------------------------------- */
/*  Fetch / list installations                                                */
/* -------------------------------------------------------------------------- */

export interface RawInstallationRecord {
  _id?: string;
  id?: string;
  installationId?: string;
  userAddress?: Address;
  smartAccountAddress?: Address;
  skillId?: unknown;
  chainId?: number;
  status?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Calls `GET /installations?userAddress=...&chainId=...&smartAccountAddress=...`
 * and returns the raw response body. Backend returns `{ data: Installation[] }`
 * but we accept both shapes.
 */
export async function listInstallationsForUser(
  request: <T>(path: string, options?: RequestInit) => Promise<T>,
  params: { userAddress: Address; chainId: number; smartAccountAddress: Address },
): Promise<RawInstallationRecord[]> {
  const query = new URLSearchParams({
    userAddress: params.userAddress,
    chainId: String(params.chainId),
    smartAccountAddress: params.smartAccountAddress,
  }).toString();

  const body = await request<any>(`/installations?${query}`, { method: 'GET' });
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.items)
        ? body.items
        : [];

  return list as RawInstallationRecord[];
}

/**
 * Returns an already-active installation for the same triple
 * (user, smartAccount, skillId), if one exists. Used by proof scripts to
 * skip `/installations/prepare` and `/installations/confirm` on re-runs.
 *
 * "Active" means the user has a current, non-paused, non-revoked
 * installation. Paused is NOT considered already-installed, because
 * `/confirm` is idempotent for paused entries only if the backend treats
 * paused as terminal (it does not; pause/resume live on top of an active
 * installation). So we treat active OR paused as "skip prepare" only when
 * the persisted parameters actually match what we want to install — see
 * `findMatchingActiveOrPausedInstallation` for the safer variant.
 */
export function findActiveOrPausedInstallation(
  installations: RawInstallationRecord[],
  params: { userAddress: Address; smartAccountAddress: Address; skillId: string },
): RawInstallationRecord | undefined {
  const targetUser = getAddress(params.userAddress);
  const targetSa = getAddress(params.smartAccountAddress);
  const targetSkillId = params.skillId;

  return installations.find((installation) => {
    if (!installation.userAddress || !installation.smartAccountAddress) return false;
    if (installation.skillId !== targetSkillId) return false;
    if (installation.status !== 'active' && installation.status !== 'paused') return false;
    if (getAddress(installation.userAddress) !== targetUser) return false;
    if (getAddress(installation.smartAccountAddress) !== targetSa) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/*  Client-side parameter validation                                          */
/* -------------------------------------------------------------------------- */

export class ProofParameterError extends Error {
  constructor(
    message: string,
    public readonly key?: string,
  ) {
    super(message);
    this.name = 'ProofParameterError';
  }
}

/**
 * Mirror of `validateSkillParameters` from
 * `src/modules/skills/skill-parameter-validation.ts`, but throwing
 * `ProofParameterError` instead of `BadRequestException`.
 *
 * The rules:
 *  - Reject unknown keys not in `definitions[].key`.
 *  - Reject duplicate keys in the input array.
 *  - `select`: value MUST match `options[].value` (string compare). If
 *    `metadata.address` is set, it must pass `getAddress` checksum.
 *  - `number`: value must be a finite number; honor `min`/`max`/`integer`.
 *  - `boolean`: value must be a real boolean.
 *  - `string`: must match `minLength`/`maxLength`/`pattern`.
 *  - `address`: must pass `getAddress` checksum.
 *  - If `required` and no value provided, use `defaultValue`; otherwise fail.
 */
export function validateParametersClientSide(
  definitions: SkillParameterDefinition[] | undefined,
  input: SkillParameterInput[] | Record<string, unknown> | undefined,
): Record<string, unknown> {
  const defs = definitions ?? [];
  const defByKey = new Map<string, SkillParameterDefinition>();
  for (const def of defs) defByKey.set(def.key, def);

  const provided = normalizeInput(input);

  for (const key of Object.keys(provided)) {
    if (!defByKey.has(key)) {
      throw new ProofParameterError(`Unknown skill parameter: ${key}`, key);
    }
  }

  const normalized: Record<string, unknown> = {};

  for (const def of defs) {
    const hasValue = Object.prototype.hasOwnProperty.call(provided, def.key);
    const rawValue = hasValue ? provided[def.key] : def.defaultValue;

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      if (def.required && def.defaultValue === undefined) {
        throw new ProofParameterError(`Missing required skill parameter: ${def.key}`, def.key);
      }
      if (def.defaultValue === undefined) continue;
    }

    normalized[def.key] = validateOne(def, rawValue, def.key);
  }

  return normalized;
}

function normalizeInput(
  input: SkillParameterInput[] | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (Array.isArray(input)) {
    const out: Record<string, unknown> = {};
    for (const entry of input) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as SkillParameterInput).key !== 'string' ||
        !Object.prototype.hasOwnProperty.call(entry, 'value')
      ) {
        throw new ProofParameterError('Each parameter entry must be { key: string, value: unknown }');
      }
      const k = (entry as SkillParameterInput).key;
      if (Object.prototype.hasOwnProperty.call(out, k)) {
        throw new ProofParameterError(`Duplicate skill parameter in input array: ${k}`, k);
      }
      out[k] = (entry as SkillParameterInput).value;
    }
    return out;
  }
  if (typeof input === 'object') return { ...(input as Record<string, unknown>) };
  throw new ProofParameterError('Skill parameters must be an object or array of { key, value }');
}

function validateOne(
  def: SkillParameterDefinition,
  rawValue: unknown,
  key: string,
): unknown {
  switch (def.type) {
    case 'select': {
      if (typeof rawValue !== 'string') {
        throw new ProofParameterError(`Skill parameter ${key} must be a string select value`, key);
      }
      const options = def.options.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));
      const selected = options.find((o) => o.value === rawValue);
      if (!selected) {
        throw new ProofParameterError(
          `Skill parameter ${key} must be one of: ${options.map((o) => o.value).join(', ')}`,
          key,
        );
      }
      const metaAddr = selected.metadata?.address;
      if (metaAddr !== undefined) {
        try {
          getAddress(metaAddr);
        } catch (err) {
          throw new ProofParameterError(
            `Skill parameter ${key} option metadata has invalid address: ${String(metaAddr)}`,
            key,
          );
        }
      }
      return selected.value;
    }
    case 'number': {
      if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
        throw new ProofParameterError(`Skill parameter ${key} must be a number`, key);
      }
      const asString = String(rawValue).trim();
      if (asString === '' || !Number.isFinite(Number(asString))) {
        throw new ProofParameterError(`Skill parameter ${key} must be a finite number`, key);
      }
      if (def.integer && !/^-?\d+$/.test(asString)) {
        throw new ProofParameterError(`Skill parameter ${key} must be an integer`, key);
      }
      if (def.min !== undefined && Number(asString) < Number(def.min)) {
        throw new ProofParameterError(`Skill parameter ${key} must be >= ${def.min}`, key);
      }
      if (def.max !== undefined && Number(asString) > Number(def.max)) {
        throw new ProofParameterError(`Skill parameter ${key} must be <= ${def.max}`, key);
      }
      return asString;
    }
    case 'boolean': {
      if (typeof rawValue !== 'boolean') {
        throw new ProofParameterError(`Skill parameter ${key} must be a boolean`, key);
      }
      return rawValue;
    }
    case 'string': {
      if (typeof rawValue !== 'string') {
        throw new ProofParameterError(`Skill parameter ${key} must be a string`, key);
      }
      if (def.minLength !== undefined && rawValue.length < def.minLength) {
        throw new ProofParameterError(`Skill parameter ${key} is too short`, key);
      }
      if (def.maxLength !== undefined && rawValue.length > def.maxLength) {
        throw new ProofParameterError(`Skill parameter ${key} is too long`, key);
      }
      if (def.pattern !== undefined && !new RegExp(def.pattern).test(rawValue)) {
        throw new ProofParameterError(`Skill parameter ${key} does not match required pattern`, key);
      }
      return rawValue;
    }
    case 'address': {
      if (typeof rawValue !== 'string') {
        throw new ProofParameterError(`Skill parameter ${key} must be an address string`, key);
      }
      try {
        return getAddress(rawValue);
      } catch (err) {
        throw new ProofParameterError(
          `Skill parameter ${key} is not a valid address: ${rawValue}`,
          key,
        );
      }
    }
    default: {
      const neverDef: never = def;
      throw new ProofParameterError(`Unsupported skill parameter type: ${String(neverDef)}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Convenience: pick a skill from the backend response                       */
/* -------------------------------------------------------------------------- */

/**
 * Locates the skill with the given `skillId` from a normalized `/skills`
 * response body. Returns `undefined` if not found.
 */
export function pickSkillById(
  skillsResponse: any,
  skillId: string,
): Record<string, unknown> | undefined {
  const list = Array.isArray(skillsResponse)
    ? skillsResponse
    : Array.isArray(skillsResponse?.data)
      ? skillsResponse.data
      : Array.isArray(skillsResponse?.items)
        ? skillsResponse.items
        : Array.isArray(skillsResponse?.skills)
          ? skillsResponse.skills
          : [];

  return (list as Array<Record<string, unknown>>).find((skill) => skill?.skillId === skillId);
}

/**
 * Extracts `parameters` from a skill document, coercing to the typed
 * definition list. Backend may store each parameter under `parameters` or
 * `params`. Either is acceptable.
 */
export function getSkillParameterDefinitions(skill: Record<string, unknown> | undefined): SkillParameterDefinition[] {
  if (!skill) return [];
  const raw = (skill.parameters ?? skill.params ?? []) as SkillParameterDefinition[];
  return Array.isArray(raw) ? raw : [];
}
