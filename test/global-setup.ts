import { MongoMemoryServer } from 'mongodb-memory-server';

declare global {
  // eslint-disable-next-line no-var
  var __mongo: MongoMemoryServer | undefined;
}

export default async function setup(): Promise<void> {
  if (process.env.SKIP_MONGO_MEMORY) return;
  const mongo = await MongoMemoryServer.create();
  global.__mongo = mongo;
  process.env.MONGO_URI = mongo.getUri();
}
