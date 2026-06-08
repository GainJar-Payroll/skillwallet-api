import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { SpendReservation } from './schemas/spend-reservation.schema';
import { DailySpendCounter } from './schemas/daily-spend-counter.schema';
import { SpendReservationsService } from './spend-reservations.service';

describe('SpendReservationsService', () => {
  let service: SpendReservationsService;
  let reservationModel: {
    find: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    updateOne: jest.Mock;
  };
  let counterModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
  };

  beforeEach(async () => {
    reservationModel = {
      find: jest.fn().mockReturnValue({
        lean: () => ({ exec: jest.fn().mockResolvedValue([]) }),
      }),
      findById: jest.fn().mockReturnValue({
        lean: () => ({ exec: jest.fn().mockResolvedValue(null) }),
      }),
      create: jest.fn().mockResolvedValue({ _id: 'res_1' }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    counterModel = {
      findOne: jest.fn().mockReturnValue({
        lean: () => ({ exec: jest.fn().mockResolvedValue(null) }),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };

    const mod = await Test.createTestingModule({
      providers: [
        SpendReservationsService,
        { provide: getModelToken(SpendReservation.name), useValue: reservationModel },
        { provide: getModelToken(DailySpendCounter.name), useValue: counterModel },
      ],
    }).compile();

    service = mod.get(SpendReservationsService);
  });

  it('caps actual reservation by inbound amount and daily remaining', async () => {
    counterModel.findOneAndUpdate.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue({ _id: 'counter_1', used: '500000' }),
    });

    const result = await service.reserveDailySpend({
      installationId: 'inst_1',
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      dailyLimit: 1_000_000n,
      desiredAmount: 900_000n,
      inboundAmount: 500_000n,
      now: new Date('2026-06-06T12:00:00.000Z'),
    });

    expect(result.periodKey).toBe('2026-06-06');
    expect(result.requestedAmount).toBe('900000');
    expect(result.actualAmount).toBe('500000');
    expect(result.reservationId).toBe('res_1');
    expect(reservationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 'inst_1',
        amount: '500000',
        status: 'reserved',
      }),
    );
  });

  it('returns actualAmount=0 when counter cannot be incremented and partial is zero', async () => {
    counterModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    counterModel.findOne.mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue({ _id: 'counter_1', used: '1000000' }),
      }),
    });

    const result = await service.reserveDailySpend({
      installationId: 'inst_1',
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      dailyLimit: 1_000_000n,
      desiredAmount: 100_000n,
      inboundAmount: 100_000n,
    });

    expect(result.actualAmount).toBe('0');
    expect(result.remainingAmount).toBe('0');
    expect(reservationModel.create).not.toHaveBeenCalled();
  });

  it('creates a new counter on first reserve when no doc exists', async () => {
    counterModel.findOneAndUpdate.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(null),
    });
    counterModel.findOne.mockReturnValueOnce({
      lean: () => ({ exec: jest.fn().mockResolvedValue(null) }),
    });
    counterModel.create.mockResolvedValueOnce({});

    const result = await service.reserveDailySpend({
      installationId: 'inst_1',
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      dailyLimit: 1_000_000n,
      desiredAmount: 200_000n,
      inboundAmount: 200_000n,
    });

    expect(counterModel.create).toHaveBeenCalled();
    expect(result.actualAmount).toBe('200000');
  });

  it('retries with partial amount when first atomic update fails but counter exists', async () => {
    counterModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({ _id: 'counter_1', used: '950000' }),
      });
    counterModel.findOne.mockReturnValueOnce({
      lean: () => ({
        exec: jest.fn().mockResolvedValue({ _id: 'counter_1', used: '900000' }),
      }),
    });

    const result = await service.reserveDailySpend({
      installationId: 'inst_1',
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      dailyLimit: 1_000_000n,
      desiredAmount: 500_000n,
      inboundAmount: 500_000n,
    });

    expect(result.actualAmount).toBe('100000');
  });

  it('releases a reserved reservation and decrements the counter', async () => {
    reservationModel.findById.mockReturnValueOnce({
      lean: () => ({
        exec: jest.fn().mockResolvedValue({
          _id: 'res_1',
          installationId: 'inst_1',
          tokenAddress: '0xToken',
          periodKey: '2026-06-06',
          amount: '500000',
          status: 'reserved',
        }),
      }),
    });
    counterModel.updateOne.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue({}),
    });

    await service.releaseReservation('res_1');

    expect(reservationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'res_1' },
      { $set: { status: 'released' } },
    );
    expect(counterModel.updateOne).toHaveBeenCalled();
  });

  it('does not decrement counter when releasing an already-confirmed reservation', async () => {
    reservationModel.findById.mockReturnValueOnce({
      lean: () => ({
        exec: jest.fn().mockResolvedValue({
          _id: 'res_1',
          installationId: 'inst_1',
          tokenAddress: '0xToken',
          periodKey: '2026-06-06',
          amount: '500000',
          status: 'confirmed',
        }),
      }),
    });

    await service.releaseReservation('res_1');

    expect(counterModel.updateOne).not.toHaveBeenCalled();
  });

  it('confirmReservation does not touch the counter', async () => {
    reservationModel.findById.mockReturnValueOnce({
      lean: () => ({
        exec: jest.fn().mockResolvedValue({
          _id: 'res_1',
          installationId: 'inst_1',
          tokenAddress: '0xToken',
          periodKey: '2026-06-06',
          amount: '500000',
          status: 'reserved',
        }),
      }),
    });

    await service.confirmReservation('res_1');

    expect(reservationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'res_1' },
      { $set: { status: 'confirmed' } },
    );
    expect(counterModel.updateOne).not.toHaveBeenCalled();
  });

  it('releaseAllExpired releases only reservations from prior UTC days', async () => {
    reservationModel.find.mockReturnValueOnce({
      lean: () => ({
        exec: jest.fn().mockResolvedValue([
          {
            _id: 'old_1',
            installationId: 'inst_1',
            tokenAddress: '0xToken',
            periodKey: '2026-06-05',
            amount: '100',
            status: 'reserved',
          },
        ]),
      }),
    });
    reservationModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    counterModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    const result = await service.releaseAllExpired(new Date('2026-06-06T01:00:00.000Z'));

    expect(result.releasedCount).toBe(1);
    expect(reservationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'old_1', status: 'reserved' },
      { $set: { status: 'released' } },
    );
    expect(counterModel.updateOne).toHaveBeenCalled();
  });
});
