import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { OneShotService } from '../src/modules/oneshot/oneshot.service';
import { X402Service } from '../src/modules/x402/x402.service';
import { VeniceService } from '../src/modules/venice/venice.service';
import { TEST_SMART_ACCOUNT, TEST_USER } from './helpers';

const apiKey = { 'x-api-key': process.env.ADMIN_API_KEY || 'test-admin-key' };

function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

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

  beforeAll(async () => {
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
  });

  beforeEach(async () => {
    try {
      await conn.collection('skills').deleteMany({});
      await conn.collection('installations').deleteMany({});
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
        '/admin/skills/seed',
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
    expect(res.text).toContain('SkillWallet Proof');
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
    expect(seeded.body.seeded).toEqual(['Generic DCA']);

    const list = await request(app.getHttpServer()).get('/skills').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].name).toBe('Generic DCA');

    await request(app.getHttpServer())
      .get(`/skills/${list.body.data[0].skillId}`)
      .expect(200);
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
