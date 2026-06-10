process.env.NODE_ENV = 'test';
process.env.PORT = '0';
if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb://localhost:0/test';
}
process.env.MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
process.env.MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:0';
process.env.RPC_BASE_SEPOLIA = process.env.RPC_BASE_SEPOLIA || 'https://sepolia.base.org';
process.env.RPC_BASE_MAINNET = process.env.RPC_BASE_MAINNET || 'https://mainnet.base.org';
process.env.BASE_SEPOLIA_RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_BASE_SEPOLIA;
process.env.BASE_MAINNET_RPC_URL =
  process.env.BASE_MAINNET_RPC_URL || process.env.RPC_BASE_MAINNET;
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key-0001';
process.env.ONE_SHOT_RPC_URL = process.env.ONE_SHOT_RPC_URL || 'https://test.1shot.rpctest.com/json-rpc';
process.env.ONESHOT_RELAYER_URL =
  process.env.ONESHOT_RELAYER_URL || process.env.ONE_SHOT_RPC_URL;
process.env.VENICE_API_KEY = process.env.VENICE_API_KEY || 'test-venice-key';
process.env.VENICE_BASE_URL = process.env.VENICE_BASE_URL || 'https://api.venice.test';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || '*';
