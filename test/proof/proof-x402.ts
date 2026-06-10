/**
 * test/proof/proof-x402.ts
 *
 * End-to-end test of OttoAI x402.ottoai.services/crypto-news API.
 * Uses x402 v2 protocol (@x402/fetch + @x402/evm).
 * v1 x402 library (x402 v0.8.0) is INCOMPATIBLE — OttoAI uses v2 only.
 *
 * Run: bun run test/proof/proof-x402.ts
 */

import 'dotenv/config';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';

// ── Env ────────────────────────────────────────────────────────────────────

const sponsorPk = process.env.SPONSOR_PRIVATE_KEY as `0x${string}`;
const ottoUrl =
  process.env.OTTOAI_NEWS_URL || 'https://x402.ottoai.services/crypto-news';
const baseRpc =
  process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';

if (!sponsorPk || sponsorPk === '0x0000000000000000000000000000000000000000000000000000000000000000') {
  console.error('Missing SPONSOR_PRIVATE_KEY in .env');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function step(title: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`  ${title}`);
  console.log('='.repeat(80));
}

function log(label: string, data?: unknown) {
  const time = new Date().toISOString();
  const prefix = `[${time}] ${label}`;
  if (data !== undefined) {
    const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    console.log(`${prefix}\n${str}`);
  } else {
    console.log(prefix);
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────

step('Setup signer and public client');

const account = privateKeyToAccount(sponsorPk);
log('Signer address', account.address);

const publicClient = createPublicClient({
  chain: base,
  transport: http(baseRpc),
});

log('Base mainnet RPC ready', { chainId: base.id, rpc: baseRpc.replace(/\/\/.*@/, '//REDACTED@') });

// Check USDC balance
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const usdcBalance = await publicClient.readContract({
  address: USDC as `0x${string}`,
  abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }], stateMutability: 'view' }],
  functionName: 'balanceOf',
  args: [account.address],
});
log('USDC balance', { units: usdcBalance.toString(), usdc: Number(usdcBalance) / 1_000_000 });

// ── Step 1: Initial request (manual, to inspect payment-required) ──────────

step('Step 1: Initial request (expect 402)');

log('GET', ottoUrl);
const res1 = await fetch(ottoUrl);
log('Response status', res1.status);

const paymentRequiredHeader =
  res1.headers.get('PAYMENT-REQUIRED') || res1.headers.get('payment-required');

if (!paymentRequiredHeader) {
  if (res1.ok) {
    const data = await res1.json();
    log('No x402 required — endpoint returned 200 directly', data);
    const outputPath = path.resolve(__dirname, 'x402-response.json');
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    log('Response saved', outputPath);
    process.exit(0);
  }
  console.error('No PAYMENT-REQUIRED header in 402 response');
  process.exit(1);
}

function tryParseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')); } catch {}
  try {
    const safe = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = safe.padEnd(safe.length + ((4 - (safe.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
  } catch {
    throw new Error(`Cannot parse PAYMENT-REQUIRED:\n${raw.substring(0, 200)}`);
  }
}

const paymentRequired = tryParseJson(paymentRequiredHeader) as Record<string, unknown>;
log('Parsed PAYMENT-REQUIRED', {
  x402Version: paymentRequired.x402Version,
  extensions: Object.keys((paymentRequired.extensions as Record<string, unknown>) || {}),
});

// ── Step 2: Use x402 v2 client with ExactEvmScheme ─────────────────────────

step('Step 2: Create x402 v2 fetch wrapper');

// v2 uses the exact network identifier that the server provides
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: 'eip155:8453',
      client: new ExactEvmScheme(account),
    },
  ],
});

log('x402 v2 fetch wrapper created', {
  network: 'eip155:8453',
  scheme: 'ExactEvmScheme',
  signer: account.address,
});

// ── Step 3: Retry with automatic payment handling ──────────────────────────

step('Step 3: Retry with x402 v2 payment');

log('Fetching with payment...', ottoUrl);

try {
  const res2 = await fetchWithPayment(ottoUrl, { method: 'GET' });
  log('Response status', res2.status);

  if (res2.ok) {
    const data = await res2.json();
    const preview = JSON.stringify(data).substring(0, 600);
    log('Response data preview', preview);

    if (typeof data === 'object' && data !== null) {
      log('Response top-level keys', Object.keys(data as Record<string, unknown>));
    }

    const outputPath = path.resolve(__dirname, 'x402-response.json');
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    log('Response saved', outputPath);

    step('SUCCESS — x402 v2 flow completed');
    log('Summary', {
      signer: account.address,
      url: ottoUrl,
      responseSize: JSON.stringify(data).length,
    });
  } else {
    const errBody = await res2.text().catch(() => '');
    const paymentResponse = res2.headers.get('PAYMENT-RESPONSE');
    console.error('Payment failed');
    log('Error details', {
      status: res2.status,
      statusText: res2.statusText,
      body: errBody.substring(0, 500),
      paymentResponse,
      headers: Object.fromEntries(res2.headers.entries()),
    });
    process.exit(1);
  }
} catch (err: any) {
  console.error('x402 v2 fetch error:', err.message);
  if (err.cause) console.error('Cause:', err.cause);
  process.exit(1);
}
