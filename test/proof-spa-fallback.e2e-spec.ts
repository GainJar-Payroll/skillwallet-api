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
import { TEST_USER } from './helpers';

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

describe('Proof SPA fallback and browser-noise filter', () => {
  let app: INestApplication;
  let conn: Connection;
  const proofAppDir = join(process.cwd(), 'public', 'proof-app');

  beforeAll(async () => {
    mkdirSync(proofAppDir, { recursive: true });
    writeFileSync(
      join(proofAppDir, 'index.html'),
      '<!DOCTYPE html><html><body><div id="root">SkillWallet Proof Dashboard</div></body></html>',
    );

    process.env.MONGODB_URI = dbUriFor('proof-spa-fallback');
    process.env.MONGODB_DB_NAME = 'proof-spa-fallback';
    const { AppModule } = await import('../src/app.module');

    const oneShot = {
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

  it('serves the React proof app at /proof-app/', async () => {
    const res = await request(app.getHttpServer()).get('/proof-app/').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SkillWallet Proof Dashboard');
  });

  it('falls back to the React proof app index for any /proof-app/* path', async () => {
    const res = await request(app.getHttpServer()).get('/proof-app/anything').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SkillWallet Proof Dashboard');
  });

  it('serves the bare /proof harness HTML for backward compatibility', async () => {
    const res = await request(app.getHttpServer()).get('/proof').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SkillWallet Proof Dashboard');
  });

  it('returns 204 for browser noise paths', async () => {
    const noisePaths = [
      '/favicon.ico',
      '/OneSignalSDKWorker.js',
      '/service-worker.js',
      '/robots.txt',
      '/sitemap.xml',
      '/apple-touch-icon.png',
      '/apple-touch-icon-precomposed.png',
    ];

    for (const path of noisePaths) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
    }
  });

  it('still returns 404 for unknown API paths that are not browser noise', async () => {
    await request(app.getHttpServer()).get('/not-a-real-route').expect(404);
  });

  it('does not return 204 for noise paths on non-GET methods', async () => {
    await request(app.getHttpServer()).post('/favicon.ico').expect(404);
  });
});
