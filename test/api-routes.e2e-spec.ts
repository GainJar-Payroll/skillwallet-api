import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OneShotService } from '../src/modules/oneshot/oneshot.service';
import { X402Service } from '../src/modules/x402/x402.service';
import { VeniceService } from '../src/modules/venice/venice.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { TEST_SMART_ACCOUNT, TEST_SMART_ACCOUNT_CHECKSUM, TEST_USER } from './helpers';

const apiKey = { 'x-api-key': process.env.ADMIN_API_KEY || 'test-admin-key' };

function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SkillWallet Backend API')
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'admin-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
}

function dbUriFor(name: string): string {
  return process.env.MONGO_URI!.replace(/\/[^/?]*(\?.*)?$/, `/${name}$1`);
}

describe('API route smoke e2e', () => {
  let app: INestApplication;
  let conn: Connection;
  let oneShot: {
    getCapabilities: jest.Mock;
    getStatus: jest.Mock;
    send7710Transaction: jest.Mock;
    poll: jest.Mock;
  };
  const proofAppDir = join(process.cwd(), 'public', 'proof-app');

  beforeAll(async () => {
    mkdirSync(proofAppDir, { recursive: true });
    writeFileSync(
      join(proofAppDir, 'index.html'),
      '<!DOCTYPE html><html><body><div id="root">SkillWallet Proof Dashboard</div></body></html>',
    );

    process.env.MONGODB_URI = dbUriFor('api-routes');
    process.env.MONGODB_DB_NAME = 'api-routes';
    const { AppModule } = await import('../src/app.module');

    oneShot = {
      getCapabilities: jest.fn().mockResolvedValue({ '84532': { feeCollector: TEST_USER, targetAddress: TEST_USER } }),
      getStatus: jest.fn().mockResolvedValue({ status: 200, hash: '0xH' }),
      send7710Transaction: jest.fn().mockResolvedValue('0x' + 'ab'.repeat(32)),
      poll: jest.fn().mockResolvedValue({ status: 200, hash: '0xH' }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OneShotService)
      .useValue(oneShot)
      .overrideProvider(X402Service)
      .useValue({ fetch: jest.fn().mockResolvedValue({ headlines: 'Market steady' }) })
      .overrideProvider(VeniceService)
      .useValue({ summariseMarketContext: jest.fn().mockResolvedValue('DCA context') })
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    conn = app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    try {
      await conn?.dropDatabase();
    } catch {}
    await app?.close();
    rmSync(proofAppDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    try {
      await conn.collection('skills').deleteMany({});
      await conn.collection('installations').deleteMany({});
      await conn.collection('spendreservations').deleteMany({});
    } catch {}
    jest.clearAllMocks();
    oneShot.getCapabilities.mockResolvedValue({ '84532': { feeCollector: TEST_USER, targetAddress: TEST_USER } });
    oneShot.getStatus.mockResolvedValue({ status: 200, hash: '0xH' });
    oneShot.send7710Transaction.mockResolvedValue('0x' + 'ab'.repeat(32));
    oneShot.poll.mockResolvedValue({ status: 200, hash: '0xH' });
  });

  it('serves the API index at /', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.body.name).toBe('SkillWallet Backend');
    expect(res.body.endpoints.proof).toBe('/proof');
    expect(res.body.endpoints.docs).toBe('/docs');
  });

  it('serves the OpenAPI document and Swagger UI under /docs', async () => {
    const json = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(json.body.openapi).toBeDefined();
    const paths = Object.keys(json.body.paths);
      expect(paths).toEqual(
        expect.arrayContaining([
          '/skills',
          '/installations',
          '/installations/prepare',
          '/installations/confirm',
          '/installations/{id}/executions',
          '/admin/skills/seed',
          '/admin/events/simulate',
          '/executor/address',
          '/health',
        ]),
      );

    const ui = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(ui.text.toLowerCase()).toContain('swagger');
  });

  it('serves the proof harness at /proof', async () => {
    const res = await request(app.getHttpServer()).get('/proof').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SkillWallet Proof Dashboard');
  });

  it('serves browser-safe proof runtime config at /proof/config', async () => {
    const res = await request(app.getHttpServer()).get('/proof/config').expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        clientId: process.env.CLIENT_ID,
        chainId: 84532,
        chainIdHex: '0x14a34',
        pimlicoBundlerUrl: process.env.PIMLICO_BUNDLER_URL,
        sponsorshipPolicyId: process.env.SPONSORSHIP_POLICY_ID,
      }),
    );
    expect(res.body.clientSecret).toBeUndefined();
    expect(res.body.CLIENT_SECRET).toBeUndefined();
  });

  it('calls health and executor read APIs', async () => {
    const health = await request(app.getHttpServer()).get('/health').expect(200);
    expect(health.body.status).toBe('ok');

    const executor = await request(app.getHttpServer()).get('/executor/address').expect(200);
    expect(executor.body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(executor.body.chainId).toBe(84532);
  });

  it('calls admin seed and skills APIs', async () => {
    const seeded = await request(app.getHttpServer())
      .post('/admin/skills/seed')
      .set(apiKey)
      .expect(201);
    expect(seeded.body.seeded).toEqual(['Generic DCA', 'USDC Inbound DCA']);

    const list = await request(app.getHttpServer()).get('/skills').expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.map((skill: { name: string }) => skill.name)).toEqual(
      expect.arrayContaining(['Generic DCA', 'USDC Inbound DCA']),
    );

    await request(app.getHttpServer())
      .get(`/skills/${list.body.data[0].skillId}`)
      .expect(200);
  });

  it('returns installed skill summaries when wallet query params are provided', async () => {
    await request(app.getHttpServer()).post('/admin/skills/seed').set(apiKey).expect(201);

    const skills = await request(app.getHttpServer()).get('/skills').expect(200);
    const skill = skills.body.data.find(
      (entry: { skillId: string }) => entry.skillId === 'generic-dca-84532',
    );

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
      .get(`/skills?userAddress=${TEST_USER}&smartAccountAddress=${TEST_SMART_ACCOUNT}`)
      .expect(200);

    const installedSkill = res.body.data.find(
      (entry: { skillId: string }) => entry.skillId === skill.skillId,
    );

    expect(installedSkill.installation).toEqual(
      expect.objectContaining({
        status: 'active',
      }),
    );
  });

  it('applies chainId and smartAccountAddress filters on GET /installations', async () => {
    await request(app.getHttpServer()).post('/admin/skills/seed').set(apiKey).expect(201);
    const skills = await request(app.getHttpServer()).get('/skills?active=false').expect(200);
    const baseSkill = skills.body.data.find((entry: { chainId: number }) => entry.chainId === 84532);

    const firstPrepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: baseSkill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: baseSkill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: firstPrepare.body.salt,
        signedDelegation: { ...firstPrepare.body.delegation, signature: '0x' + '22'.repeat(65) },
      })
      .expect(201);

    await conn.collection('installations').insertOne({
      userAddress: TEST_USER,
      smartAccountAddress: '0x0000000000000000000000000000000000000def',
      skillId: baseSkill.skillId,
      signedDelegation: {
        delegate: '0x0000000000000000000000000000000000000def',
        delegator: '0x0000000000000000000000000000000000000def',
        salt: '0x' + '33'.repeat(32),
        signature: '0x' + '44'.repeat(65),
      },
      delegationSalt: '0x' + '33'.repeat(32),
      chainId: 8453,
      parameters: {},
      status: 'active',
      executions: [],
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
      updatedAt: new Date('2026-06-05T00:00:00.000Z'),
    });

    const res = await request(app.getHttpServer())
      .get(
        `/installations?userAddress=${TEST_USER}&chainId=84532&smartAccountAddress=${TEST_SMART_ACCOUNT}`,
      )
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].smartAccountAddress).toBe(TEST_SMART_ACCOUNT_CHECKSUM);
  });

  it('simulates an event-trigger execution and exposes proof-ready history metadata', async () => {
    const seeded = await request(app.getHttpServer())
      .post('/admin/skills/seed')
      .set(apiKey)
      .expect(201);
    expect(seeded.body.seeded).toEqual(['Generic DCA', 'USDC Inbound DCA']);

    const skills = await request(app.getHttpServer()).get('/skills').expect(200);
    const eventSkill = skills.body.data.find(
      (skill: { skillId: string }) => skill.skillId === 'usdc-inbound-dca-84532',
    );
    expect(eventSkill).toBeDefined();

    const parameters = {
      outputToken: 'weth',
      spendMode: 'percent-of-inbound',
      amountPerRun: '100000',
      percentOfInboundBps: '5000',
      dailySpendLimit: '900000',
    };

    const prepare = await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({
        skillId: eventSkill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        parameters,
      })
      .expect(201);

    const confirm = await request(app.getHttpServer())
      .post('/installations/confirm')
      .send({
        skillId: eventSkill.skillId,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        delegationSalt: prepare.body.salt,
        signedDelegation: { ...prepare.body.delegation, signature: '0x' + '22'.repeat(65) },
        parameters,
      })
      .expect(201);

    const simulate = await request(app.getHttpServer())
      .post('/admin/events/simulate')
      .set(apiKey)
      .send({
        skillId: eventSkill.skillId,
        chainId: 84532,
        event: {
          contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
          txHash: '0x' + 'ab'.repeat(32),
          logIndex: 3,
          blockNumber: '123',
          args: {
            from: TEST_USER,
            to: TEST_SMART_ACCOUNT,
            value: '1000000',
          },
        },
      })
      .expect(201);

    expect(simulate.body).toEqual(
      expect.objectContaining({
        skillId: 'usdc-inbound-dca-84532',
        matchedInstallations: 1,
        executedInstallations: 1,
      }),
    );

    let executionsRes: request.Response | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      executionsRes = await request(app.getHttpServer())
        .get(`/installations/${confirm.body._id}/executions`)
        .expect(200);

      if (Array.isArray(executionsRes.body.data) && executionsRes.body.data.length > 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(executionsRes).toBeDefined();
    expect(executionsRes!.body.installationId).toBe(confirm.body._id);
    expect(executionsRes!.body.data[0]).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/submitted|confirmed/),
        trigger: expect.objectContaining({
          type: 'event-trigger',
          event: expect.objectContaining({
            chainId: 84532,
            contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            args: expect.objectContaining({
              to: TEST_SMART_ACCOUNT,
              value: '1000000',
            }),
          }),
        }),
        spend: expect.objectContaining({
          tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          requestedAmount: '500000',
          actualAmount: '500000',
          dailyLimit: '900000',
          periodKey: expect.any(String),
        }),
      }),
    );
  });

  it('calls installation prepare/list APIs using seeded Generic DCA', async () => {
    await request(app.getHttpServer())
      .post('/admin/skills/seed')
      .set(apiKey)
      .expect(201);
    const skills = await request(app.getHttpServer()).get('/skills').expect(200);
    const skillId = skills.body.data[0].skillId;

    await request(app.getHttpServer())
      .post('/installations/prepare')
      .send({ skillId, userAddress: TEST_USER, smartAccountAddress: TEST_SMART_ACCOUNT })
      .expect(201);

    const installations = await request(app.getHttpServer())
      .get(`/installations?userAddress=${TEST_USER}`)
      .expect(200);
    expect(installations.body.data).toEqual([]);
  });

  it('calls proof task status API', async () => {
    const taskId = '0x' + 'ab'.repeat(32);
    const res = await request(app.getHttpServer()).get(`/proof/status/${taskId}`).expect(200);
    expect(res.body.status).toBe(200);
    expect(oneShot.getStatus).toHaveBeenCalledWith(taskId);
  });
});
