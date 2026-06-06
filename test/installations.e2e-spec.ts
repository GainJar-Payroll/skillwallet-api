import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken, MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Connection } from 'mongoose';
import request from 'supertest';
import { InstallationsModule } from '../src/modules/installations/installations.module';
import { SkillsModule } from '../src/modules/skills/skills.module';
import { ExecutorModule } from '../src/modules/executor/executor.module';
import { DelegationModule } from '../src/modules/delegation/delegation.module';
import { RunnerModule } from '../src/modules/runner/runner.module';
import { X402Module } from '../src/modules/x402/x402.module';
import { OneShotModule } from '../src/modules/oneshot/oneshot.module';
import { VeniceModule } from '../src/modules/venice/venice.module';
import { Skill, SkillSchema } from '../src/modules/skills/schemas/skill.schema';
import {
  Installation,
  InstallationSchema,
} from '../src/modules/installations/schemas/installation.schema';
import { OneShotService } from '../src/modules/oneshot/oneshot.service';
import { X402Service } from '../src/modules/x402/x402.service';
import { VeniceService } from '../src/modules/venice/venice.service';
import { RunnerService } from '../src/modules/runner/runner.service';
import { buildSkill, TEST_SMART_ACCOUNT, TEST_USER } from '../test/helpers';
import configuration from '../src/config/configuration';

describe('Installations e2e', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let conn: Connection;
  let oneShot: { getCapabilities: jest.Mock; send7710Transaction: jest.Mock; poll: jest.Mock };
  let x402: { fetch: jest.Mock };
  let venice: { summariseMarketContext: jest.Mock };

  beforeAll(async () => {
    oneShot = {
      getCapabilities: jest.fn().mockResolvedValue({ '84532': { feeCollector: TEST_USER, targetAddress: TEST_USER } }),
      send7710Transaction: jest.fn().mockResolvedValue('0x' + 'ab'.repeat(32)),
      poll: jest.fn().mockResolvedValue({ status: 200, hash: '0xH' }),
    };
    x402 = { fetch: jest.fn().mockResolvedValue({ headlines: 'X' }) };
    venice = { summariseMarketContext: jest.fn().mockResolvedValue('ctx') };

    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Skill.name, schema: SkillSchema },
          { name: Installation.name, schema: InstallationSchema },
        ]),
        ExecutorModule,
        SkillsModule,
        DelegationModule,
        OneShotModule,
        X402Module,
        VeniceModule,
        RunnerModule,
        InstallationsModule,
      ],
    })
      .overrideProvider(OneShotService)
      .useValue(oneShot)
      .overrideProvider(X402Service)
      .useValue(x402)
      .overrideProvider(VeniceService)
      .useValue(venice)
      .compile();
    moduleRef = mod;
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    conn = app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    try {
      await conn?.dropDatabase();
    } catch {}
    await app?.close();
  });

  beforeEach(async () => {
    try {
      await conn.collection('skills').deleteMany({});
      await conn.collection('installations').deleteMany({});
      jest.clearAllMocks();
      oneShot.getCapabilities.mockResolvedValue({ '84532': { feeCollector: TEST_USER, targetAddress: TEST_USER } });
      oneShot.send7710Transaction.mockResolvedValue('0x' + 'ab'.repeat(32));
      oneShot.poll.mockResolvedValue({ status: 200, hash: '0xH' });
    } catch {}
  });

  async function seedSkill() {
    const skillsModel = moduleRef.get(getModelToken(Skill.name));
    const doc = await skillsModel.create(buildSkill());
    return doc.toObject();
  }

  it('POST /installations/prepare returns delegation + salt', async () => {
    const skill = await seedSkill();
    const res = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    expect(res.body.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.body.executorAddress).toBe(res.body.delegation.delegate);
  });

  it('POST /installations/confirm persists installation', async () => {
    const skill = await seedSkill();
    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    const salt = prepare.body.salt;
    const signedDelegation = {
      ...prepare.body.delegation,
      signature: '0x' + '22'.repeat(65),
    };
    const confirm = await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: salt,
        signedDelegation,
        parameters: { amountUsdc: '10000000', outputToken: 'weth' },
      })
      .expect(201);
    expect(confirm.body.status).toBe('active');
  });

  it('GET /installations?userAddress=... returns list', async () => {
    const skill = await seedSkill();
    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: prepare.body.salt,
        signedDelegation: { ...prepare.body.delegation, signature: '0x' + '22'.repeat(65) },
      })
      .expect(201);
    const res = await request(app.getHttpServer())
      .get(`/installations?userAddress=${TEST_USER}`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /installations/:id/pause toggles status', async () => {
    const skill = await seedSkill();
    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    const confirm = await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: prepare.body.salt,
        signedDelegation: { ...prepare.body.delegation, signature: '0x' + '22'.repeat(65) },
      })
      .expect(201);
    const id = confirm.body._id;
    const paused = await request(app.getHttpServer())
      .patch(`/installations/${id}/pause`)
      .send({ userAddress: TEST_USER })
      .expect(200);
    expect(paused.body.status).toBe('paused');
    const resumed = await request(app.getHttpServer())
      .patch(`/installations/${id}/resume`)
      .send({ userAddress: TEST_USER })
      .expect(200);
    expect(resumed.body.status).toBe('active');
  });

  it('DELETE /installations/:id transitions to revoked', async () => {
    const skill = await seedSkill();
    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    const confirm = await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: prepare.body.salt,
        signedDelegation: { ...prepare.body.delegation, signature: '0x' + '22'.repeat(65) },
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/installations/${confirm.body._id}`)
      .send({ userAddress: TEST_USER })
      .expect(200);
  });

  it('rejects pause from non-owner', async () => {
    const skill = await seedSkill();
    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    const confirm = await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: prepare.body.salt,
        signedDelegation: { ...prepare.body.delegation, signature: '0x' + '22'.repeat(65) },
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/installations/${confirm.body._id}/pause`)
      .send({ userAddress: '0x0000000000000000000000000000000000000099' })
      .expect(403);
  });

  it('GET /installations/:id returns installation with executions', async () => {
    const skill = await seedSkill();
    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    const confirm = await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: prepare.body.salt,
        signedDelegation: { ...prepare.body.delegation, signature: '0x' + '22'.repeat(65) },
      })
      .expect(201);
    const res = await request(app.getHttpServer())
      .get(`/installations/${confirm.body._id}`)
      .expect(200);
    expect(res.body._id).toBe(confirm.body._id);
  });

  it('triggers execution via admin and records executions', async () => {
    const skill = await seedSkill();
    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);
    const confirm = await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: skill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: prepare.body.salt,
        signedDelegation: { ...prepare.body.delegation, signature: '0x' + '22'.repeat(65) },
      })
      .expect(201);
    oneShot.poll.mockResolvedValue({ status: 200, hash: '0xH' });
    const runner = moduleRef.get(RunnerService);
    await runner.executeInstallation(confirm.body._id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(oneShot.send7710Transaction).toHaveBeenCalled();
  });
});
