import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo: MongoMemoryServer | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __mongo: MongoMemoryServer | undefined;
}

export default async function teardown(): Promise<void> {
  const m = global.__mongo;
  if (m) {
    await m.stop();
  } else if (mongo) {
    await mongo.stop();
  }
}
