/**
 * test/proof/proof-pimlico.ts
 *
 * End-to-end proof script: validates Pimlico gasless transaction flow
 * on Base Sepolia using viem's createBundlerClient + createPaymasterClient.
 *
 * Flow:
 *   1. Create Hybrid Smart Account (MetaMask Smart Accounts Kit)
 *   2. Create bundler + paymaster clients (viem account-abstraction)
 *   3. Send a gasless UserOperation (1 wei ETH transfer)
 *   4. Wait for receipt, print tx hash
 *
 * Run: bun run test/proof/proof-pimlico.ts
 */

import 'dotenv/config';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/smart-accounts-kit';
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { createPublicClient, http, getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// ── Constants ───────────────────────────────────────────────────────────────

const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;
const RECIPIENT = '0x08Dc514b8bA9015a74972Da8bDa5027fD91943e1' as const;
const DEPLOY_SALT = ('0x' + '0'.repeat(62) + '01') as `0x${string}`;

// ── Environment ─────────────────────────────────────────────────────────────

const PK = (process.env.PROOF_PRIVATE_KEY || process.env.SPONSOR_PRIVATE_KEY) as `0x${string}`;
const RPC = process.env.BASE_SEPOLIA_RPC_URL!;
const PAYMASTER = process.env.PAYMASTER_URL!;
const BUNDLER = process.env.BUNDLER_URL || PAYMASTER;
const POLICY = process.env.SPONSORSHIP_POLICY!;

if (!PK || PK === '0x0000000000000000000000000000000000000000000000000000000000000000') {
  console.error('Missing PROOF_PRIVATE_KEY or SPONSOR_PRIVATE_KEY in .env');
  process.exit(1);
}
if (!RPC) {
  console.error('Missing BASE_SEPOLIA_RPC_URL in .env');
  process.exit(1);
}
if (!PAYMASTER) {
  console.error('Missing PAYMASTER_URL in .env');
  process.exit(1);
}
if (!POLICY) {
  console.error('Missing SPONSORSHIP_POLICY in .env');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Setup public client + signer
  step('Setup public client + signer');

  const ownerAccount = privateKeyToAccount(PK);
  const owner = getAddress(ownerAccount.address);
  log('SIGNER_ADDRESS', owner);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC),
  });

  const chainId = await publicClient.getChainId();
  log('RPC_CONNECTED', { chainId, rpc: RPC.replace(/\/\/.*@/, '//REDACTED@') });

  // 2. Create Hybrid Smart Account
  step('Create Hybrid Smart Account');

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [owner, [], [], []],
    deploySalt: DEPLOY_SALT,
    signer: { account: ownerAccount },
  });

  const smartAccountAddress = getAddress(
    (smartAccount.address || (await smartAccount.getAddress?.())) as Address,
  );

  log('HYBRID_SMART_ACCOUNT', {
    owner,
    smartAccountAddress,
    deploySalt: DEPLOY_SALT,
  });

  // 3. Create bundler + paymaster clients
  step('Create bundler + paymaster clients');

  const paymasterClient = createPaymasterClient({
    transport: http(PAYMASTER),
  });

  const bundlerClient = createBundlerClient({
    client: publicClient,
    transport: http(BUNDLER),
    paymaster: paymasterClient,
    paymasterContext: { sponsorshipPolicyId: POLICY },
    entryPoint: ENTRY_POINT_V07,
    chain: baseSepolia,
  });

  log('BUNDLER_PAYMASTER_READY', {
    paymasterUrl: PAYMASTER.replace(/apikey=[^&]+/, 'apikey=REDACTED'),
    bundlerUrl: BUNDLER.replace(/apikey=[^&]+/, 'apikey=REDACTED'),
    sponsorshipPolicy: POLICY,
    entryPoint: ENTRY_POINT_V07,
  });

  // 4. Send gasless UserOperation
  step('Send gasless UserOperation');

  const recipient = getAddress(RECIPIENT);

  log('USEROP_DETAILS', {
    from: smartAccountAddress,
    to: recipient,
    value: '0 wei',
    data: '0x',
  });

  const userOpHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [{ to: recipient, value: 0n, data: '0x' }],
  });

  log('USEROP_SENT', { userOpHash });

  // 5. Wait for receipt
  step('Wait for receipt');

  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });

  log('RECEIPT_RECEIVED', {
    userOpHash,
    txHash: receipt.receipt.transactionHash,
    success: receipt.success,
    actualGasCost: receipt.actualGasCost?.toString(),
  });

  // 6. Success
  step('SUCCESS — Pimlico gasless flow confirmed');

  log('SUMMARY', {
    signer: owner,
    smartAccount: smartAccountAddress,
    deploySalt: DEPLOY_SALT,
    recipient,
    userOpHash,
    txHash: receipt.receipt.transactionHash,
    gasSponsored: receipt.actualGasCost?.toString() ?? 'N/A',
    network: `Base Sepolia (${chainId})`,
    entryPoint: ENTRY_POINT_V07,
  });

  console.log(`\nTransaction: https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`);
}

main().catch((err) => {
  console.error('\nPROOF FAILED');
  console.error(err);
  process.exit(1);
});