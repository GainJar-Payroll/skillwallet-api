import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SpendReservation,
  SpendReservationDocument,
} from './schemas/spend-reservation.schema';

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

@Injectable()
export class SpendReservationsService {
  constructor(
    @InjectModel(SpendReservation.name)
    private readonly reservationModel: Model<SpendReservationDocument>,
  ) {}

  getUtcDayPeriodKey(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  async reserveDailySpend(input: ReserveDailySpendInput): Promise<DailySpendReservationResult> {
    const periodKey = this.getUtcDayPeriodKey(input.now);
    const spentOrReserved = await this.getSpentOrReservedAmount(
      input.installationId,
      input.tokenAddress,
      periodKey,
    );

    const remaining = input.dailyLimit > spentOrReserved ? input.dailyLimit - spentOrReserved : 0n;
    const cappedByInbound = input.desiredAmount < input.inboundAmount ? input.desiredAmount : input.inboundAmount;
    const actualAmount = cappedByInbound < remaining ? cappedByInbound : remaining;

    if (actualAmount <= 0n) {
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
    });

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
    await this.reservationModel
      .updateOne({ _id: reservationId }, { $set: { status: 'confirmed' } })
      .exec();
  }

  async releaseReservation(reservationId: string): Promise<void> {
    await this.reservationModel
      .updateOne({ _id: reservationId }, { $set: { status: 'released' } })
      .exec();
  }

  private async getSpentOrReservedAmount(
    installationId: string,
    tokenAddress: string,
    periodKey: string,
  ): Promise<bigint> {
    const reservations = await this.reservationModel
      .find({
        installationId,
        tokenAddress,
        periodKey,
        status: { $in: ['reserved', 'confirmed'] },
      })
      .lean()
      .exec();

    return reservations.reduce((sum, reservation) => sum + BigInt(reservation.amount), 0n);
  }
}
