import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { SpendReservation } from './schemas/spend-reservation.schema';
import { SpendReservationsService } from './spend-reservations.service';

describe('SpendReservationsService', () => {
  let service: SpendReservationsService;
  let model: {
    find: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
  };

  beforeEach(async () => {
    model = {
      find: jest.fn().mockReturnValue({
        lean: () => ({ exec: jest.fn().mockResolvedValue([]) }),
      }),
      create: jest.fn().mockResolvedValue({ _id: 'res_1' }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };

    const mod = await Test.createTestingModule({
      providers: [
        SpendReservationsService,
        { provide: getModelToken(SpendReservation.name), useValue: model },
      ],
    }).compile();

    service = mod.get(SpendReservationsService);
  });

  it('caps actual reservation by inbound amount and daily remaining', async () => {
    model.find.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue([{ amount: '300000', status: 'confirmed' }]) }),
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
  });
});
