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

export function nextRunFromFrequency(from: Date | null, frequency: 'daily' | 'weekly' | 'monthly'): Date | null {
  if (!from) return null;
  return new Date(from.getTime() + frequencyToPeriodSeconds(frequency) * 1000);
}
