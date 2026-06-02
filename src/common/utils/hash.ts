import { createHash } from 'crypto';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stable((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function sha256Hex(value: unknown): `0x${string}` {
  return `0x${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}
