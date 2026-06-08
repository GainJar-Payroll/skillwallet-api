import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SpendReservation,
  SpendReservationDocument,
} from './schemas/spend-reservation.schema';
import {
  DailySpendCounter,
  DailySpendCounterDocument,
} from './schemas/daily-spend-counter.schema';

export interface ReserveDailySpendInput {
  installationId: string;
  tokenAddress: string;
  dailyLimit: bigint;
  desiredAmount: bigint;
  inboundAmount: bigint;
  now?: Date;
}

export interface DailySpendReservationResult {
  periodKey: string;
  dailyLimit: string;
  requestedAmount: string;
  actualAmount: string;
  remainingAmount: string;
  reservationId?: string;
}

const COUNTER_ID_SEP = ':';

function buildCounterId(
  installationId: string,
  tokenAddress: string,
  periodKey: string,
): string {
  return `${installationId}${COUNTER_ID_SEP}${tokenAddress.toLowerCase()}${COUNTER_ID_SEP}${periodKey}`;
}

function parseBigInt(value: unknown, fallback = 0n): bigint {
  if (value === null || value === undefined) return fallback;
  try {
    return BigInt(String(value));
  } catch {
    return fallback;
  }
}

@Injectable()
export class SpendReservationsService {
  private readonly logger = new Logger(SpendReservationsService.name);

  constructor(
    @InjectModel(SpendReservation.name)
    private readonly reservationModel: Model<SpendReservationDocument>,
    @InjectModel(DailySpendCounter.name)
    private readonly counterModel: Model<DailySpendCounterDocument>,
  ) {}

  getUtcDayPeriodKey(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  async reserveDailySpend(input: ReserveDailySpendInput): Promise<DailySpendReservationResult> {
    const periodKey = this.getUtcDayPeriodKey(input.now);
    const cappedByInbound =
      input.desiredAmount < input.inboundAmount ? input.desiredAmount : input.inboundAmount;

    if (cappedByInbound <= 0n) {
      return {
        periodKey,
        dailyLimit: input.dailyLimit.toString(),
        requestedAmount: input.desiredAmount.toString(),
        actualAmount: '0',
        remainingAmount: input.dailyLimit.toString(),
      };
    }

    const counterId = buildCounterId(input.installationId, input.tokenAddress, periodKey);
    const actualAmount = await this.tryReserve(counterId, input, cappedByInbound, periodKey);

    if (actualAmount === null) {
      return {
        periodKey,
        dailyLimit: input.dailyLimit.toString(),
        requestedAmount: input.desiredAmount.toString(),
        actualAmount: '0',
        remainingAmount: '0',
      };
    }

    if (actualAmount <= 0n) {
      const remaining = await this.getRemaining(counterId, input.dailyLimit);
      return {
        periodKey,
        dailyLimit: input.dailyLimit.toString(),
        requestedAmount: input.desiredAmount.toString(),
        actualAmount: '0',
        remainingAmount: remaining.toString(),
      };
    }

    const reservation = await this.reservationModel.create({
      installationId: input.installationId,
      tokenAddress: input.tokenAddress,
      periodKey,
      amount: actualAmount.toString(),
      status: 'reserved',
      expiresAt: this.computeExpiry(periodKey),
    });

    const used = await this.getUsed(counterId);
    const remaining = input.dailyLimit > used ? input.dailyLimit - used : 0n;

    return {
      periodKey,
      dailyLimit: input.dailyLimit.toString(),
      requestedAmount: input.desiredAmount.toString(),
      actualAmount: actualAmount.toString(),
      remainingAmount: remaining.toString(),
      reservationId: String(reservation._id),
    };
  }

  async confirmReservation(reservationId: string): Promise<void> {
    const reservation = await this.reservationModel
      .findById(reservationId)
      .lean()
      .exec();

    if (!reservation) return;

    await this.reservationModel
      .updateOne(
        { _id: reservationId },
        { $set: { status: 'confirmed' } },
      )
      .exec();

    // Confirmed reservations still count towards the daily held amount
    // because the onchain spend happened. No counter change.
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const reservation = await this.reservationModel
      .findById(reservationId)
      .lean()
      .exec();

    if (!reservation) return;

    if (reservation.status !== 'reserved') return;

    await this.reservationModel
      .updateOne(
        { _id: reservationId },
        { $set: { status: 'released' } },
      )
      .exec();

    const counterId = buildCounterId(
      reservation.installationId,
      reservation.tokenAddress,
      reservation.periodKey,
    );
    const amount = BigInt(String(reservation.amount));

    // Atomic decrement with floor at zero. $max prevents underflow when a
    // reservation is released after the counter has already been decremented
    // (e.g. by a prior release of the same period).
    await this.counterModel
      .updateOne(
        { _id: counterId },
        [
          {
            $set: {
              used: {
                $max: [
                  0,
                  {
                    $subtract: [{ $ifNull: ['$used', 0] }, Number(amount)],
                  },
                ],
              },
            },
          },
        ],
      )
      .exec();
  }

  /**
   * Releases every still-reserved reservation whose periodKey is older than
   * the current UTC day. Returns the number of rows released and the
   * counter decrements applied.
   */
  async releaseAllExpired(now: Date = new Date()): Promise<{ releasedCount: number }> {
    const currentPeriodKey = this.getUtcDayPeriodKey(now);
    const expired = await this.reservationModel
      .find({ status: 'reserved', periodKey: { $lt: currentPeriodKey } })
      .lean()
      .exec();

    let releasedCount = 0;
    for (const reservation of expired) {
      await this.reservationModel
        .updateOne(
          { _id: reservation._id, status: 'reserved' },
          { $set: { status: 'released' } },
        )
        .exec();
      releasedCount += 1;

      const counterId = buildCounterId(
        reservation.installationId,
        reservation.tokenAddress,
        reservation.periodKey,
      );
      const amount = BigInt(String(reservation.amount));
      await this.counterModel
        .updateOne(
          { _id: counterId },
          [
            {
              $set: {
                used: {
                  $max: [
                    0,
                    {
                      $subtract: [{ $ifNull: ['$used', 0] }, Number(amount)],
                    },
                  ],
                },
              },
            },
          ],
        )
        .exec();
    }

    if (releasedCount > 0) {
      this.logger.log(
        `Released ${releasedCount} expired spend reservations before ${currentPeriodKey}`,
      );
    }
    return { releasedCount };
  }

  private async tryReserve(
    counterId: string,
    input: ReserveDailySpendInput,
    cappedByInbound: bigint,
    periodKey: string,
  ): Promise<bigint | null> {
    const maxRetries = 4;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const updated = await this.atomicIncrementIfWithinLimit(
        counterId,
        cappedByInbound,
        input.dailyLimit,
      );

      if (updated) {
        return cappedByInbound;
      }

      const existing = await this.counterModel.findOne({ _id: counterId }).lean().exec();

      if (!existing) {
        const created = await this.tryCreate(
          counterId,
          input,
          cappedByInbound,
          periodKey,
        );
        if (created === 'ok') return cappedByInbound;
        if (created === 'race') continue;
        return null;
      }

      const used = parseBigInt(existing.used);
      const remaining = input.dailyLimit > used ? input.dailyLimit - used : 0n;
      const partial = remaining < cappedByInbound ? remaining : cappedByInbound;

      if (partial <= 0n) {
        return 0n;
      }

      const partialUpdated = await this.atomicIncrementIfWithinLimit(
        counterId,
        partial,
        input.dailyLimit,
      );

      if (partialUpdated) {
        return partial;
      }
    }

    return null;
  }

  private async tryCreate(
    counterId: string,
    input: ReserveDailySpendInput,
    amount: bigint,
    periodKey: string,
  ): Promise<'ok' | 'race' | 'limit'> {
    if (amount > input.dailyLimit) {
      // Even on an empty counter, this single reservation would exceed the limit.
      return 'limit';
    }

    try {
      await this.counterModel.create({
        _id: counterId,
        installationId: input.installationId,
        tokenAddress: input.tokenAddress,
        periodKey,
        used: Number(amount),
      });
      return 'ok';
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 11000) {
        // Duplicate key: another caller created the counter. Retry via update path.
        return 'race';
      }
      throw err;
    }
  }

  private async atomicIncrementIfWithinLimit(
    counterId: string,
    amount: bigint,
    limit: bigint,
  ): Promise<boolean> {
    const result = await this.counterModel
      .findOneAndUpdate(
        {
          _id: counterId,
          $expr: {
            $lte: [
              {
                $add: [
                  { $ifNull: ['$used', 0] },
                  Number(amount),
                ],
              },
              Number(limit),
            ],
          },
        },
        { $inc: { used: Number(amount) } },
        { new: true, upsert: false },
      )
      .exec();

    return result !== null;
  }

  private async getUsed(counterId: string): Promise<bigint> {
    const doc = await this.counterModel.findOne({ _id: counterId }).lean().exec();
    const value = doc ? Number((doc as { used?: number }).used ?? 0) : 0;
    return BigInt(value);
  }

  private async getRemaining(counterId: string, limit: bigint): Promise<bigint> {
    const used = await this.getUsed(counterId);
    return limit > used ? limit - used : 0n;
  }

  private computeExpiry(periodKey: string): Date {
    // periodKey is YYYY-MM-DD UTC; expire 2 days after the period ends.
    const [yStr, mStr, dStr] = periodKey.split('-');
    const year = Number(yStr);
    const monthIndex = Number(mStr) - 1;
    const day = Number(dStr);
    return new Date(Date.UTC(year, monthIndex, day + 2, 0, 0, 0, 0));
  }
}
