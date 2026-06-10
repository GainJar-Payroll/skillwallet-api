import { Types } from 'mongoose';
import { getAddress } from 'viem';
import type { Skill } from '../src/modules/skills/schemas/skill.schema';
import type { Installation } from '../src/modules/installations/schemas/installation.schema';

export const TEST_USER =
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`;
export const TEST_EXECUTOR =
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as `0x${string}`;
export const TEST_DELEGATOR_PK =
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356' as `0x${string}`;

export const DCA_DAILY_SCOPE = {
  type: 'Erc20PeriodTransfer',
  tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  maxAmount: '0x5f5e100',
  periodAmount: '0x5f5e100',
  periodDuration: 86400,
  startDate: Math.floor(Date.now() / 1000),
};

export function buildSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'DCA Daily',
    skillId: 'custom-cron-dca-84532',
    description: 'Custom Cron DCA',
    iconUrl: 'https://example.com/icon.png',
    runType: 'cron',
    cronExpression: '0 0 * * *',
    trigger: undefined,
    execution: undefined,
    limits: undefined,
    chainId: 84532,
    delegationScope: DCA_DAILY_SCOPE as never,
    parameters: [
      { key: 'amountUsdc', label: 'Amount', type: 'number', required: true, defaultValue: '10000000' },
      {
        key: 'outputToken',
        label: 'Output',
        type: 'select',
        required: true,
        options: [
          {
            label: 'WETH',
            value: 'weth',
            metadata: {
              address: '0x4200000000000000000000000000000000000006',
              symbol: 'WETH',
              decimals: 18,
            },
          },
          { label: 'cbBTC', value: 'cbBtc', metadata: { symbol: 'cbBTC', decimals: 8 } },
        ],
        defaultValue: 'weth',
      },
    ],
    isActive: true,
    metadata: {},
    ...overrides,
  } as Skill;
}

export function buildInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    userAddress: TEST_USER,
    skillId: 'custom-cron-dca-84532',
    signedDelegation: {
      delegate: TEST_EXECUTOR,
      delegator: TEST_SMART_ACCOUNT,
      salt: '0x' + '11'.repeat(32),
      signature: '0x' + '22'.repeat(65),
    },
    smartAccountAddress: TEST_SMART_ACCOUNT,
    delegationSalt: '0x' + '11'.repeat(32),
    chainId: 84532,
    parameters: { amountUsdc: '10000000', outputToken: 'weth' },
    status: 'active',
    executions: [],
    ...overrides,
  } as Installation;
}

export function buildMockSkillModel() {
  const data: Record<string, Skill & { _id: Types.ObjectId }> = {};
  const docs = (s: Skill) => ({
    ...s,
    _id: s._id ?? new Types.ObjectId(),
    toObject() {
      return { ...this };
    },
    save: jest.fn().mockImplementation(async function () {
      return this;
    }),
  });

  return {
    find: jest.fn().mockReturnValue({
      sort: () => ({
        lean: () => ({ exec: jest.fn().mockResolvedValue(Object.values(data)) }),
      }),
      lean: () => ({ exec: jest.fn().mockResolvedValue(Object.values(data)) }),
    }),
    findOne: jest.fn().mockImplementation((filter: { skillId?: string }) => ({
      lean: () => ({
        exec: jest.fn().mockResolvedValue(
          Object.values(data).find((d) => d.skillId === filter.skillId) ?? null,
        ),
      }),
    })),
    findById: jest.fn().mockImplementation((id: string) => ({
      lean: () => ({
        exec: jest.fn().mockResolvedValue(
          Object.values(data).find((d) => String(d._id) === id) ?? null,
        ),
      }),
      exec: jest.fn().mockResolvedValue(
        Object.values(data).find((d) => String(d._id) === id)
          ? docs(Object.values(data).find((d) => String(d._id) === id) as Skill)
          : null,
      ),
    })),
    findOneAndUpdate: jest.fn().mockImplementation(
      (filter: { name?: string }, payload: { $set: Skill }) => ({
        exec: jest.fn().mockImplementation(async () => {
          const existing = Object.values(data).find((d) => d.name === filter.name);
          if (existing) {
            Object.assign(existing, payload.$set);
            return docs(existing);
          }
          const created = { ...payload.$set, _id: new Types.ObjectId() };
          data[String(created._id)] = created as never;
          return docs(created as Skill);
        }),
      }),
    ),
    findByIdAndUpdate: jest.fn().mockImplementation((id: string) => ({
      exec: jest.fn().mockImplementation(async () => {
        const existing = Object.values(data).find((d) => String(d._id) === id);
        if (!existing) return null;
        existing.isActive = false;
        return docs(existing);
      }),
    })),
    create: jest.fn().mockImplementation(async (payload: Skill) => {
      const created = { ...payload, _id: new Types.ObjectId() };
      data[String(created._id)] = created as never;
      return docs(created as Skill);
    }),
    __seed: (s: Skill) => {
      const withId = { ...s, _id: s._id ?? new Types.ObjectId() } as never;
      data[String(withId._id)] = withId;
      return withId;
    },
  };
}

export function buildMockInstallationModel() {
  const data: Record<string, Installation> = {};
  const wrap = (i: Installation) => ({
    ...i,
    _id: i._id ?? new Types.ObjectId(),
    toObject() {
      return { ...this };
    },
    save: jest.fn().mockImplementation(async function () {
      const id = String(this._id);
      data[id] = { ...(this as Installation), _id: this._id };
      return this;
    }),
    markModified: jest.fn(),
  });

  return {
    find: jest.fn().mockImplementation(
      (filterArg?: {
        userAddress?: string;
        smartAccountAddress?: string;
        chainId?: number;
        skillId?: string | { $in?: string[] };
        status?: string | { $in?: string[] };
      }) => {
        const applyFilter = () => {
          const all = Object.values(data);

          return all.filter((i) => {
            if (
              filterArg?.userAddress &&
              i.userAddress.toLowerCase() !== filterArg.userAddress.toLowerCase()
            ) {
              return false;
            }
            if (
              filterArg?.smartAccountAddress &&
              i.smartAccountAddress.toLowerCase() !== filterArg.smartAccountAddress.toLowerCase()
            ) {
              return false;
            }
            if (filterArg?.chainId !== undefined && i.chainId !== filterArg.chainId) return false;
            if (typeof filterArg?.skillId === 'string' && i.skillId !== filterArg.skillId) return false;
            if (
              typeof filterArg?.skillId === 'object' &&
              filterArg.skillId?.$in &&
              !filterArg.skillId.$in.includes(i.skillId)
            ) {
              return false;
            }
            if (typeof filterArg?.status === 'string' && i.status !== filterArg.status) return false;
            if (
              typeof filterArg?.status === 'object' &&
              filterArg.status?.$in &&
              !filterArg.status.$in.includes(i.status)
            ) {
              return false;
            }
            return true;
          });
        };

        const chain = {
          populate: () => ({
            lean: () => ({
              exec: jest.fn().mockImplementation(async () => applyFilter()),
            }),
          }),
          sort: () => ({
            lean: () => ({
              exec: jest.fn().mockImplementation(async () => applyFilter()),
            }),
          }),
          lean: () => ({
            exec: jest.fn().mockImplementation(async () => applyFilter()),
          }),
        };

        return chain;
      },
    ),
    findById: jest.fn().mockImplementation((id: string | Types.ObjectId) => {
      const idStr = String(id);
      const found = Object.values(data).find((i) => String(i._id) === idStr);
      return {
        populate: () => ({
          lean: () => ({
            exec: jest.fn().mockResolvedValue(found ?? null),
          }),
        }),
        exec: jest.fn().mockResolvedValue(found ? wrap(found) : null),
      };
    }),
    create: jest.fn().mockImplementation(async (payload: Installation) => {
      const created = { ...payload, _id: new Types.ObjectId() } as Installation;
      data[String(created._id)] = created;
      return wrap(created);
    }),
    findOne: jest.fn().mockImplementation((filter: { userAddress?: string; smartAccountAddress?: string; skillId?: string; status?: { $in?: string[] } }) => ({
      lean: () => ({
        exec: jest.fn().mockImplementation(async () => {
          return Object.values(data).find((i) => {
            if (filter.userAddress && i.userAddress !== filter.userAddress) return false;
            if (filter.smartAccountAddress && i.smartAccountAddress !== filter.smartAccountAddress) return false;
            if (filter.skillId && String(i.skillId) !== String(filter.skillId)) return false;
            if (filter.status?.$in && !filter.status.$in.includes(i.status)) return false;
            return true;
          }) ?? null;
        }),
      }),
    })),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }) }),
    findByIdAndUpdate: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    __seed: (i: Installation) => {
      const withId = { ...i, _id: i._id ?? new Types.ObjectId() } as Installation;
      data[String(withId._id)] = withId;
      return withId;
    },
  };
}

export function buildMockConfig(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn().mockImplementation((key: string) => values[key]),
  };
}

export function buildMockExecutorService() {
  return {
    getAddress: jest.fn().mockReturnValue(TEST_EXECUTOR),
    getAccount: jest.fn().mockReturnValue({ address: TEST_EXECUTOR }),
    getInfo: jest.fn().mockReturnValue({ address: TEST_EXECUTOR, privateKey: '0xabc' }),
    getPublicClient: jest.fn().mockReturnValue({}),
  };
}

export const TEST_SMART_ACCOUNT = '0x0000000000000000000000000000000000000abc' as `0x${string}`;
export const TEST_SMART_ACCOUNT_CHECKSUM = getAddress(TEST_SMART_ACCOUNT) as `0x${string}`;
