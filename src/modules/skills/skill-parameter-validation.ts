import { BadRequestException } from '@nestjs/common';
import { parseExpression } from 'cron-parser';
import { getAddress } from 'viem';
import type {
  SkillParameterDefinition,
  SkillParameterInput,
  SkillParameterInputPayload,
  SkillSelectOption,
} from './skill-parameter.types';

export type NormalizedSkillParameters = Record<string, unknown>;

export function validateSkillParameters(
  definitions: SkillParameterDefinition[],
  input: SkillParameterInputPayload,
): NormalizedSkillParameters {
  const parameterDefinitions = definitions ?? [];
  const provided = normalizeParameterInput(input);
  const definitionByKey = new Map(
    parameterDefinitions.map((definition) => [definition.key, definition]),
  );

  for (const key of Object.keys(provided)) {
    if (!definitionByKey.has(key)) {
      throw new BadRequestException(`Unknown skill parameter: ${key}`);
    }
  }

  const normalized: NormalizedSkillParameters = {};

  for (const definition of parameterDefinitions) {
    const hasValue = Object.prototype.hasOwnProperty.call(provided, definition.key);
    const rawValue = hasValue ? provided[definition.key] : definition.defaultValue;

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      if (definition.required && definition.defaultValue === undefined) {
        throw new BadRequestException(`Missing required skill parameter: ${definition.key}`);
      }

      if (definition.defaultValue === undefined) continue;
    }

    normalized[definition.key] = validateParameterValue(definition, rawValue, definition.key);
  }

  return normalized;
}

export function normalizeParameterInput(
  input: SkillParameterInputPayload | undefined,
): NormalizedSkillParameters {
  if (input === undefined || input === null) return {};

  if (Array.isArray(input)) {
    const normalized: NormalizedSkillParameters = {};

    for (const entry of input) {
      if (!isParameterInput(entry)) {
        throw new BadRequestException(
          'Skill parameters must be an array of { key, value } entries',
        );
      }

      if (Object.prototype.hasOwnProperty.call(normalized, entry.key)) {
        throw new BadRequestException(`Duplicate skill parameter: ${entry.key}`);
      }

      normalized[entry.key] = entry.value;
    }

    return normalized;
  }

  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as NormalizedSkillParameters;
  }

  throw new BadRequestException(
    'Skill parameters must be an object or an array of { key, value } entries',
  );
}

function validateParameterValue(
  definition: SkillParameterDefinition,
  rawValue: unknown,
  key: string,
): unknown {
  switch (definition.type) {
    case 'select': {
      if (typeof rawValue !== 'string') {
        throw new BadRequestException(`Skill parameter ${key} must be a string select value`);
      }

      const options = definition.options.map(normalizeSelectOption);
      const selected = options.find((option) => option.value === rawValue);

      if (!selected) {
        throw new BadRequestException(
          `Skill parameter ${key} must be one of: ${options.map((option) => option.value).join(', ')}`,
        );
      }

      const metadataAddress = selected.metadata?.address;
      if (metadataAddress !== undefined) getAddress(metadataAddress);

      return selected.value;
    }

    case 'number': {
      if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
        return definition.defaultValue;
      }

      const asString = String(rawValue).trim();
      if (asString === '' || !Number.isFinite(Number(asString))) {
        throw new BadRequestException(`Skill parameter ${key} must be a finite number`);
      }

      if (definition.integer && !/^-?\d+$/.test(asString)) {
        throw new BadRequestException(`Skill parameter ${key} must be an integer`);
      }

      if (definition.min !== undefined && Number(asString) < Number(definition.min)) {
        throw new BadRequestException(`Skill parameter ${key} must be >= ${definition.min}`);
      }

      if (definition.max !== undefined && Number(asString) > Number(definition.max)) {
        throw new BadRequestException(`Skill parameter ${key} must be <= ${definition.max}`);
      }

      return asString;
    }

    case 'boolean': {
      if (typeof rawValue !== 'boolean') {
        throw new BadRequestException(`Skill parameter ${key} must be a boolean`);
      }

      return rawValue;
    }

    case 'string': {
      if (typeof rawValue !== 'string') {
        throw new BadRequestException(`Skill parameter ${key} must be a string`);
      }

      if (definition.minLength !== undefined && rawValue.length < definition.minLength) {
        throw new BadRequestException(`Skill parameter ${key} is too short`);
      }

      if (definition.maxLength !== undefined && rawValue.length > definition.maxLength) {
        throw new BadRequestException(`Skill parameter ${key} is too long`);
      }

      if (definition.pattern !== undefined && !new RegExp(definition.pattern).test(rawValue)) {
        throw new BadRequestException(`Skill parameter ${key} does not match required pattern`);
      }

      return rawValue;
    }

    case 'address': {
      if (typeof rawValue !== 'string') {
        throw new BadRequestException(`Skill parameter ${key} must be an address string`);
      }

      return getAddress(rawValue);
    }

    case 'cron': {
      if (typeof rawValue !== 'string') {
        throw new BadRequestException(`Skill parameter ${key} must be a string`);
      }

      try {
        parseExpression(rawValue);
      } catch {
        throw new BadRequestException(
          `Skill parameter ${key} is not a valid cron expression: ${rawValue}`,
        );
      }

      return rawValue;
    }

    default: {
      const neverDefinition: never = definition;
      throw new BadRequestException(`Unsupported skill parameter type: ${String(neverDefinition)}`);
    }
  }
}

function normalizeSelectOption(option: SkillSelectOption | string): SkillSelectOption {
  if (typeof option === 'string') return { label: option, value: option };
  return option;
}

function isParameterInput(value: unknown): value is SkillParameterInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SkillParameterInput).key === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'value')
  );
}
