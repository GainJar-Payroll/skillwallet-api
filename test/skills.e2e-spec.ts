import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Connection } from 'mongoose';
import request from 'supertest';
import { SkillsModule } from '../src/modules/skills/skills.module';
import { Skill, SkillSchema } from '../src/modules/skills/schemas/skill.schema';
import configuration from '../src/config/configuration';

describe('Skills e2e', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let conn: Connection;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([{ name: Skill.name, schema: SkillSchema }]),
        SkillsModule,
      ],
    }).compile();
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
    } catch {}
  });

  const apiKey = { 'x-api-key': process.env.ADMIN_API_KEY || 'test-admin-key' };

  it('POST /skills creates a cron skill', async () => {
    const dto = {
      name: 'DCA Daily',
      skillId: 'dca-daily-84532',
      description: 'Daily DCA into WETH',
      iconUrl: 'https://example.com/icon.png',
      runType: 'cron',
      cronExpression: '0 0 * * *',
      chainId: 84532,
      delegationScope: { type: 'Erc20PeriodTransfer' },
    };
    const res = await request(app.getHttpServer())
      .post('/skills')
      .set(apiKey)
      .send(dto)
      .expect(201);
    expect(res.body.name).toBe('DCA Daily');
    expect(res.body.isActive).toBe(true);
  });

  it('POST /skills rejects cron without expression', async () => {
    const dto = {
      name: 'X',
      description: 'X',
      iconUrl: 'X',
      runType: 'cron',
      chainId: 84532,
      delegationScope: { type: 'Erc20PeriodTransfer' },
    };
    await request(app.getHttpServer()).post('/skills').set(apiKey).send(dto).expect(400);
  });

  it('GET /skills returns list', async () => {
    await request(app.getHttpServer())
      .post('/skills')
      .set(apiKey)
      .send({
        name: 'S',
        skillId: 'skill-s-84532',
        description: 'S',
        iconUrl: 'S',
        runType: 'cron',
        cronExpression: '*/5 * * * *',
        chainId: 84532,
        delegationScope: { type: 'X' },
      })
      .expect(201);
    const res = await request(app.getHttpServer()).get('/skills').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /skills/:id returns 404 for unknown id', async () => {
    await request(app.getHttpServer())
      .get('/skills/507f1f77bcf86cd799439011')
      .expect(404);
  });

  it('PATCH /skills/:id updates skill', async () => {
    const created = await request(app.getHttpServer())
      .post('/skills')
      .set(apiKey)
      .send({
        name: 'A',
        skillId: 'skill-a-84532',
        description: 'A',
        iconUrl: 'A',
        runType: 'cron',
        cronExpression: '0 * * * *',
        chainId: 84532,
        delegationScope: { type: 'X' },
      })
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/skills/${created.body._id}`)
      .set(apiKey)
      .send({ description: 'Updated' })
      .expect(200);
    expect(res.body.description).toBe('Updated');
  });

  it('DELETE /skills/:id soft-deletes (isActive=false)', async () => {
    const created = await request(app.getHttpServer())
      .post('/skills')
      .set(apiKey)
      .send({
        name: 'B',
        skillId: 'skill-b-84532',
        description: 'B',
        iconUrl: 'B',
        runType: 'cron',
        cronExpression: '0 0 * * *',
        chainId: 84532,
        delegationScope: { type: 'X' },
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/skills/${created.body._id}`)
      .set(apiKey)
      .expect(200);
    const res = await request(app.getHttpServer())
      .get('/skills')
      .expect(200);
    const found = (res.body.data as Array<{ _id: string; isActive: boolean }>).find(
      (s) => s._id === created.body._id,
    );
    expect(found).toBeUndefined();
  });
});
