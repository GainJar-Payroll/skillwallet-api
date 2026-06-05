export function now(): Date {
  return new Date();
}

export function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function frequencyToPeriodSeconds(frequency: 'daily' | 'weekly' | 'monthly'): number {
  switch (frequency) {
    case 'daily':
      return 24 * 60 * 60;
    case 'weekly':
      return 7 * 24 * 60 * 60;
    case 'monthly':
      return 30 * 24 * 60 * 60;
  }
}

export function nextRunFromFrequency(frequency: 'daily' | 'weekly' | 'monthly', from: Date): Date;
export function nextRunFromFrequency(from: Date, frequency: 'daily' | 'weekly' | 'monthly'): Date;
export function nextRunFromFrequency(
  arg1: Date | 'daily' | 'weekly' | 'monthly',
  arg2: Date | 'daily' | 'weekly' | 'monthly',
): Date {
  const frequency = (arg1 instanceof Date ? arg2 : arg1) as 'daily' | 'weekly' | 'monthly';
  const from = (arg1 instanceof Date ? arg1 : arg2) as Date;
  return new Date(from.getTime() + frequencyToPeriodSeconds(frequency) * 1000);
}

export function nextRunFromNullable(
  from: Date | null | undefined,
  frequency: 'daily' | 'weekly' | 'monthly',
): Date | null {
  if (!from) return null;
  return nextRunFromFrequency(frequency, from);
}
