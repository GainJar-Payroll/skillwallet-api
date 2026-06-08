import { ProcessedEventService } from './processed-event.service';

describe('ProcessedEventService', () => {
  function serviceWithCreate(create: jest.Mock) {
    return new ProcessedEventService({ create } as never);
  }

  it('returns true when the event key is newly inserted', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = serviceWithCreate(create);

    await expect(
      service.tryMarkProcessed({
        chainId: 84532,
        contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        txHash: '0x' + 'ab'.repeat(32),
        logIndex: 4,
      }),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 84532,
        contractAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        txHash: '0x' + 'ab'.repeat(32),
        logIndex: 4,
      }),
    );
  });

  it('returns false when Mongo reports a duplicate event key', async () => {
    const create = jest.fn().mockRejectedValue({ code: 11000 });
    const service = serviceWithCreate(create);

    await expect(
      service.tryMarkProcessed({
        chainId: 84532,
        contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        txHash: '0x' + 'cd'.repeat(32),
        logIndex: 5,
      }),
    ).resolves.toBe(false);
  });

  it('throws on invalid event keys', async () => {
    const create = jest.fn();
    const service = serviceWithCreate(create);

    await expect(
      service.tryMarkProcessed({
        chainId: 84532,
        contractAddress: '',
        txHash: '0x' + 'ef'.repeat(32),
        logIndex: 6,
      }),
    ).rejects.toThrow(/invalid event key/);
    expect(create).not.toHaveBeenCalled();
  });
});
