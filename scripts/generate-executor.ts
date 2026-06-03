import { randomBytes } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

function generateExecutor() {
  const privateKeyBytes = randomBytes(32);
  const privateKey = `0x${privateKeyBytes.toString('hex')}` as Hex;

  const account = privateKeyToAccount(privateKey);
  const address = account.address;

  // eslint-disable-next-line no-console
  console.log('=== GENERATED EXECUTOR CREDENTIALS ===');
  // eslint-disable-next-line no-console
  console.log(`EXECUTOR_PRIVATE_KEY=${privateKey}`);
  // eslint-disable-next-line no-console
  console.log(`EXECUTOR_ADDRESS=${address}`);
  // eslint-disable-next-line no-console
  console.log('======================================');
}

generateExecutor();
