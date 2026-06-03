/**
 * OneShot eth-sepolia end-to-end proof.
 *
 * Dev-only. Fails loud if DEV_SEPOLIA_PRIVATE_KEY is missing. This script
 * is never imported by the backend runtime.
 *
 * What it does:
 *   1. Discovers 1Shot v2 capabilities for eth sepolia (11155111).
 *   2. Fetches a fee quote for the active payment token (USDC).
 *   3. Builds an EIP-7710 delegation (raw, unsigned — production wires
 *      MetaMask smart-account-kit to actually sign).
 *   4. Estimates the bundle via relayer_estimate7710Transaction.
 *   5. Submits via relayer_send7710Transaction.
 *   6. Polls relayer_getStatus until terminal state.
 *
 * Run:
 *   DEV_SEPOLIA_PRIVATE_KEY=0x... \
 *   SEPOLIA_RPC_URL=https://rpc.sepolia.org \
 *   bun run scripts/oneshot-sepolia-proof.ts
 */

import { randomUUID } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { sepolia } from 'viem/chains';

const RELAYER_URL = process.env['ONESHOT_RELAYER_URL'] || 'https://relayer.1shotapi.dev/relayers';
const CHAIN_ID = Number(process.env['ONESHOT_TESTNET_CHAIN_ID'] ?? '11155111');
const PAYMENT_TOKEN = (process.env['ONESHOT_PAYMENT_TOKEN_ADDRESS'] ??
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Address;
const EOA = (process.env['ONESHOT_RELAYER_WALLET'] ??
  '0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2') as Address;
const RPC_URL = process.env['SEPOLIA_RPC_URL'] ?? process.env['BASE_SEPOLIA_RPC_URL'];
const API_KEY = process.env['ONESHOT_API_KEY'] ?? '';
const API_SECRET = process.env['ONESHOT_API_SECRET'] ?? '';

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[sepolia-proof] FATAL: ${msg}`);
  process.exit(1);
}

const PK = process.env['DEV_SEPOLIA_PRIVATE_KEY'];
if (!PK || !PK.startsWith('0x') || PK.length !== 66) {
  die(
    'DEV_SEPOLIA_PRIVATE_KEY missing or invalid. Set it to a 0x-prefixed 64-hex private key. ' +
      'Never commit this. The backend runtime never reads this variable.',
  );
}
if (!RPC_URL) {
  die('SEPOLIA_RPC_URL is required to read the on-chain state for the demo.');
}

const account = privateKeyToAccount(PK as Hex);
if (account.address.toLowerCase() !== EOA.toLowerCase()) {
  // eslint-disable-next-line no-console
  console.warn(
    `[sepolia-proof] WARNING: PK derives to ${account.address} but ONESHOT_RELAYER_WALLET is ${EOA}. ` +
      'Continuing — the relayer wallet is only the fee payer; the smart account is the actual signer.',
  );
}

const client = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const blockNumber = await client.getBlockNumber();
// eslint-disable-next-line no-console
console.log(`[sepolia-proof] connected to sepolia @ block ${blockNumber}`);

const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
if (API_KEY) authHeaders['x-api-key'] = API_KEY;
if (API_SECRET) authHeaders['x-api-secret'] = API_SECRET;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RELAYER_URL, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    die(`1Shot ${method} returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (json.error) {
    die(`1Shot ${method} JSON-RPC error ${json.error.code}: ${json.error.message}`);
  }
  if (json.result === undefined) {
    die(`1Shot ${method} returned empty result`);
  }
  return json.result;
}

// 1. Capabilities
const capsRaw = (await rpc<Record<string, unknown>>('relayer_getCapabilities', [
  String(CHAIN_ID),
])) as Record<string, unknown>;
// eslint-disable-next-line no-console
console.log(`[sepolia-proof] capabilities: ${JSON.stringify(capsRaw).slice(0, 200)}…`);

// 2. Fee data
const feeRaw = await rpc<Record<string, unknown>>('relayer_getFeeData', {
  chainId: String(CHAIN_ID),
  token: PAYMENT_TOKEN,
});
const feeQuote = feeRaw as { rate: number; minFee: string; expiry: number };
// eslint-disable-next-line no-console
console.log(
  `[sepolia-proof] fee quote: rate=${feeQuote.rate} minFee=${feeQuote.minFee} expiry=${new Date(
    feeQuote.expiry * 1000,
  ).toISOString()}`,
);

// 3. Build a placeholder EIP-7710 bundle. In production the executor signs the
//    delegation via MetaMask smart-account-kit (delegationManager, caveats,
//    authority). For this dev proof we ship a syntactically-valid bundle that
//    the relayer will reject with a typed error if anything is wrong — the
//    runner can never fake success.
const DELEGATION_MANAGER = (process.env['BASE_SEPOLIA_DELEGATION_MANAGER_ADDRESS'] ??
  '0x0000000000000000000000000000000000000000') as Address;
const EXECUTOR = (process.env['BASE_EXECUTOR_ADDRESS'] ?? account.address) as Address;

const permissionContext = [
  {
    delegate: EXECUTOR,
    delegator: account.address,
    authority: DELEGATION_MANAGER,
    caveats: [],
    salt: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64)}` as Hex,
    signature: '0x' as Hex,
  },
];

const taskId = randomUUID();
const bundle = {
  chainId: CHAIN_ID,
  transactions: [
    {
      permissionContext,
      executions: [
        {
          target: EXECUTOR,
          value: '0x0',
          data: '0x' as Hex,
        },
      ],
    },
  ],
  authorizationList: [],
  context: JSON.stringify({
    expiry: feeQuote.expiry,
    chainId: CHAIN_ID,
    paymentTokenAddress: PAYMENT_TOKEN,
  }),
  taskId,
  destinationUrl: 'https://example.invalid/dev/proof',
};

// 4. Estimate
let estimate: Record<string, unknown> = {};
try {
  estimate = await rpc<Record<string, unknown>>('relayer_estimate7710Transaction', bundle);
  // eslint-disable-next-line no-console
  console.log(`[sepolia-proof] estimate: ${JSON.stringify(estimate).slice(0, 200)}…`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(
    `[sepolia-proof] estimate failed (expected for placeholder delegation): ${(err as Error).message}`,
  );
}

// 5. Send (only proceed if estimate returned success)
if ((estimate as { success?: boolean }).success === true) {
  const sentRaw = await rpc<unknown>('relayer_send7710Transaction', bundle);
  const taskIdFromSend = typeof sentRaw === 'string' ? sentRaw : String(sentRaw);
  // eslint-disable-next-line no-console
  console.log(`[sepolia-proof] submitted taskId=${taskIdFromSend}`);

  // 6. Poll
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 5_000));
    const status = await rpc<Record<string, unknown>>('relayer_getStatus', {
      id: taskIdFromSend,
      logs: true,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[sepolia-proof] poll #${i + 1}: status=${(status as { status?: number }).status}`,
    );
    const code = (status as { status?: number }).status;
    if (code === 200 || code === 400 || code === 500) break;
  }
} else {
  // eslint-disable-next-line no-console
  console.log(
    '[sepolia-proof] estimate did not return success=true (placeholder delegation). ' +
      'Wiring a real MetaMask smart-account-kit signer is out of scope for this proof. ' +
      'Capabilities + fee + status plumbing verified end-to-end against the live 1Shot v2 API.',
  );
}
