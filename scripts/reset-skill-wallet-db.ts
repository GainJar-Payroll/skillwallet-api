import mongoose from 'mongoose';

const GENERIC_DCA_SKILL = {
  name: 'Generic DCA',
  description:
    'Dollar-cost average USDC into a selected Base token on a fixed schedule. The executor approves USDC, swaps through SwapRouter02, and records AI market context for each run.',
  iconUrl:
    'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  runType: 'cron',
  cronExpression: '0 9 * * *',
  chainId: 84532,
  delegationScope: {
    type: 'FunctionCall',
    targets: [
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    ],
    selectors: [
      'approve(address,uint256)',
      'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
    ],
    valueLte: { maxValue: '0x0' },
  },
  parameters: [
    {
      key: 'outputToken',
      label: 'Output Token',
      type: 'select',
      required: true,
      options: ['weth', 'cbBtc'],
      defaultValue: 'weth',
      description: 'Token to accumulate with each DCA run',
    },
    {
      key: 'amountUsdc',
      label: 'Amount (USDC atoms)',
      type: 'number',
      required: true,
      defaultValue: '10000000',
      description: 'Amount of USDC to swap per run in base units. Default: 10 USDC = 10000000',
    },
  ],
  isActive: true,
  metadata: { category: 'DeFi', kind: 'dca', risk: 'medium', builtin: true },
};

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error('MONGODB_URI is missing');
}

const EXPECTED_DB = process.env.MONGODB_DB_NAME || 'skill-wallet';

function withDatabaseName(rawUri: string, dbName: string): string {
  const match = rawUri.match(/^(mongodb(?:\+srv)?:\/\/[^/?]+)(\/[^?]*)?(\?.*)?$/);
  if (!match) return rawUri;
  const [, origin, pathPart = '', queryPart = ''] = match;
  const pathHasDb = pathPart && pathPart !== '/';
  return origin + (pathHasDb ? pathPart : '/' + dbName) + queryPart;
}

const normalizedUri = withDatabaseName(uri, EXPECTED_DB);
await mongoose.connect(normalizedUri, { serverSelectionTimeoutMS: 10_000 });
const db = mongoose.connection.db;

if (!db) {
  throw new Error('Mongo database connection unavailable');
}

if (db.databaseName !== EXPECTED_DB) {
  throw new Error(`Refusing to wipe database ${db.databaseName}; expected ${EXPECTED_DB}`);
}

await db.dropDatabase();
await db.collection('skills').insertOne({
  ...GENERIC_DCA_SKILL,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const skills = await db
  .collection('skills')
  .find({}, { projection: { name: 1 } })
  .toArray();
console.log(JSON.stringify({ database: db.databaseName, wiped: true, skills }, null, 2));

await mongoose.disconnect();
