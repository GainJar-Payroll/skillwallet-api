import 'dotenv/config';
import {
  createDelegation,
  Implementation,
  ScopeType,
  toMetaMaskSmartAccount,
} from '@metamask/smart-accounts-kit';
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * test/proof/proof.ts
 *
 * No Pimlico version.
 *
 * This proof assumes the Hybrid Smart Account is already deployed.
 * Deployment is not done here because Hybrid SA deploy is ERC-4337 UserOperation flow.
 * 1Shot is used by backend runtime when /admin/installations/:id/trigger executes.
 *
 * Current backend flow:
 *   GET  /admin/executor                         x-api-key required
 *   GET  /skills
 *   POST /installations/prepare
 *   POST /installations/confirm
 *   POST /admin/installations/:id/trigger        x-api-key required
 *   GET  /installations/:id
 *
 * Required env:
 *   PORT
 *   ADMIN_API_KEY
 *   BASE_SEPOLIA_RPC_URL
 *   DEFAULT_CHAIN_ID
 *   PROOF_PRIVATE_KEY
 *
 * Removed:
 *   PIMLICO_BUNDLER_URL
 *   SPONSORSHIP_POLICY_ID
 */

const PORT = Number(process.env.PORT ?? '3000');
const API_BASE_URL = `http://localhost:${PORT}`;

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID ?? '84532');
const PROOF_PRIVATE_KEY = process.env.PROOF_PRIVATE_KEY! as Hex;

if (!BASE_SEPOLIA_RPC_URL) throw new Error('Missing BASE_SEPOLIA_RPC_URL');
if (!ADMIN_API_KEY) throw new Error('Missing ADMIN_API_KEY');

if (
  !PROOF_PRIVATE_KEY ||
  PROOF_PRIVATE_KEY === '0x0000000000000000000000000000000000000000000000000000000000000000'
) {
  throw new Error('Missing PROOF_PRIVATE_KEY');
}

if (!/^0x[0-9a-fA-F]{64}$/.test(PROOF_PRIVATE_KEY)) {
  throw new Error('PROOF_PRIVATE_KEY must be 0x + 64 hex chars');
}

if (DEFAULT_CHAIN_ID !== baseSepolia.id) {
  throw new Error(`This proof expects DEFAULT_CHAIN_ID=84532, got ${DEFAULT_CHAIN_ID}`);
}

const DEPLOY_SALT = '0x0000000000000000000000000000000000000000000000000000000000000888' as const;

const PREFERRED_SKILL_ID = 'direct-router-dca';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;
const SWAP_ROUTER_02 = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as const;

const AMOUNT_IN_USDC_ATOMS = '100000';
const FEE_TIER = 3000;
const MAX_SLIPPAGE_BPS = 50;
const FREQUENCY = 'daily';

const POLL_AFTER_TRIGGER = true;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

type BackendCaveat = {
  enforcer: Address;
  terms: Hex;
  args: Hex;
};

type BackendDelegation = {
  delegate?: Address;
  delegator?: Address;
  authority?: Hex;
  caveats?: BackendCaveat[];
  salt?: Hex;
  signature?: Hex;
};

type PrepareResponse = {
  delegate?: Address;
  delegation?: BackendDelegation;
  delegationScope?: {
    type?: string;
    targets: Address[];
    selectors: Hex[];
    valueLte?: { maxValue?: bigint | string };
  };
  prepareId?: string;
  prepareSnapshot?: unknown;
  salt?: Hex;
  skillId?: string;
  executorAddress?: Address;
  chainId?: number;
  [key: string]: unknown;
};

type ExecutionRecord = {
  executedAt?: string;
  status?: 'pending' | 'submitted' | 'confirmed' | 'failed' | string;
  oneShotTaskId?: string;
  txHash?: string;
  errorMessage?: string;
  aiContext?: string;
  newsContext?: string;
  [key: string]: unknown;
};

type InstallationResponse = {
  _id?: string;
  id?: string;
  installationId?: string;
  userAddress?: Address;
  smartAccountAddress?: Address;
  skillId?: unknown;
  signedDelegation?: unknown;
  delegationSalt?: Hex;
  chainId?: number;
  parameters?: unknown;
  status?: string;
  executions?: ExecutionRecord[];
  lastExecutedAt?: string;
  nextExecutionAt?: string;
  [key: string]: unknown;
};

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC_URL),
});

function stringify(value: unknown, space = 2) {
  return JSON.stringify(
    value,
    (_key, nested) => {
      if (typeof nested === 'bigint') return nested.toString();

      if (nested instanceof Uint8Array) {
        return `0x${Buffer.from(nested).toString('hex')}`;
      }

      if (nested instanceof Error) {
        return {
          name: nested.name,
          message: nested.message,
          stack: nested.stack,
          ...(nested as any),
        };
      }

      if (typeof nested === 'function') {
        return `[Function ${nested.name || 'anonymous'}]`;
      }

      return nested;
    },
    space,
  );
}

function log(message: string, data?: unknown) {
  const time = new Date().toISOString();
  console.log(`\n[${time}] ${message}`);
  if (data !== undefined) console.log(stringify(data));
}

function step(title: string) {
  console.log('\n' + '='.repeat(100));
  console.log(title);
  console.log('='.repeat(100));
}

function redactUrl(url: string) {
  try {
    const parsed = new URL(url);

    for (const key of ['apikey', 'apiKey', 'key', 'token', 'auth']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, 'REDACTED');
    }

    return parsed.toString();
  } catch {
    return url
      .replace(/apikey=[^&]+/gi, 'apikey=REDACTED')
      .replace(/apiKey=[^&]+/g, 'apiKey=REDACTED')
      .replace(/token=[^&]+/gi, 'token=REDACTED');
  }
}

function errorDetails(err: unknown) {
  const e = err as any;

  return {
    name: e?.name,
    message: e?.message ?? String(err),
    shortMessage: e?.shortMessage,
    details: e?.details,
    code: e?.code ?? e?.data?.code ?? e?.cause?.code,
    data: e?.data,
    cause: e?.cause
      ? {
          name: e.cause?.name,
          message: e.cause?.message,
          shortMessage: e.cause?.shortMessage,
          details: e.cause?.details,
          code: e.cause?.code ?? e.cause?.data?.code,
          data: e.cause?.data,
        }
      : undefined,
    metaMessages: e?.metaMessages,
    docsPath: e?.docsPath,
    stack: e?.stack,
    raw: stringify(err),
  };
}

function adminHeaders() {
  return { 'x-api-key': ADMIN_API_KEY };
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };

  let parsedBody: unknown = undefined;

  if (typeof options.body === 'string') {
    try {
      parsedBody = JSON.parse(options.body);
    } catch {
      parsedBody = options.body;
    }
  }

  log('HTTP_REQUEST', {
    url,
    method: options.method ?? 'GET',
    headers: Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        key.toLowerCase().includes('key') ? 'REDACTED' : value,
      ]),
    ),
    body: parsedBody,
  });

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();

  let body: any = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  log('HTTP_RESPONSE', {
    url,
    status: res.status,
    ok: res.ok,
    body,
  });

  if (!res.ok) {
    const message = body?.error?.message ?? body?.message ?? body?.raw ?? `HTTP ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }

  return (body?.payload ?? body?.data ?? body) as T;
}

async function assertCode(label: string, address: Address) {
  const code = await publicClient.getCode({ address });

  if (!code || code === '0x') {
    throw new Error(`${label} has no code at ${address}`);
  }

  log(`${label}_CODE_OK`, {
    address,
    codeLength: code.length,
  });
}

async function tokenBalance(token: Address, owner: Address) {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  });
}

async function logTokenBalance(label: string, token: Address, owner: Address, decimals: number) {
  const balance = await tokenBalance(token, owner);

  log(label, {
    owner,
    token,
    raw: balance,
    formatted: formatUnits(balance, decimals),
  });

  return balance;
}

function normalizeSkillsResponse(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.skills)) return body.skills;
  return [];
}

function getSkillIdentifier(skill: any) {
  return skill?.skillId ?? skill?._id ?? skill?.id ?? '';
}

function selectSkill(skills: any[]) {
  const byPreferredId = skills.find((skill) => getSkillIdentifier(skill) === PREFERRED_SKILL_ID);
  if (byPreferredId) return byPreferredId;

  const byMetadataKind = skills.find(
    (skill) => String(skill?.metadata?.kind ?? '').toLowerCase() === 'dca',
  );
  if (byMetadataKind) return byMetadataKind;

  const byName = skills.find((skill) =>
    String(skill?.name ?? '')
      .toLowerCase()
      .includes('dca'),
  );
  if (byName) return byName;

  return skills[0];
}

function buildDcaConfig(smartAccountAddress: Address, selectedSkill: any) {
  const amountDefault = selectedSkill?.parameters?.find?.(
    (param: any) => param?.key === 'amountUsdc',
  )?.defaultValue;

  return {
    type: 'direct-router-dca',
    tokenIn: { address: USDC },
    tokenOut: { address: WETH },
    amountPerRun: AMOUNT_IN_USDC_ATOMS || amountDefault || '100000',
    frequency: FREQUENCY,
    maxSlippageBps: MAX_SLIPPAGE_BPS,
    router: { name: 'uniswap-v3', address: SWAP_ROUTER_02 },
    feeTier: FEE_TIER,
    recipient: smartAccountAddress,
    quoteMode: 'router-quote',
  };
}

function getInstallationId(installation: InstallationResponse) {
  return installation._id ?? installation.id ?? installation.installationId ?? '';
}

function getScopeFromPrepare(prepared: PrepareResponse) {
  if (!prepared.delegationScope) {
    throw new Error(`prepare did not return delegationScope: ${stringify(prepared)}`);
  }

  return {
    type: ScopeType.FunctionCall,
    targets: prepared.delegationScope.targets,
    selectors: prepared.delegationScope.selectors,
    valueLte: { maxValue: 0n },
  } as any;
}

function buildDelegationToSign(params: {
  prepared: PrepareResponse;
  smartAccount: any;
  smartAccountAddress: Address;
}) {
  const { prepared, smartAccount, smartAccountAddress } = params;

  if (prepared.delegation) {
    const d = prepared.delegation;

    if (!d.delegate) {
      throw new Error(`prepared.delegation.delegate missing: ${stringify(prepared)}`);
    }

    if (!d.delegator) {
      throw new Error(`prepared.delegation.delegator missing: ${stringify(prepared)}`);
    }

    if (!d.authority) {
      throw new Error(`prepared.delegation.authority missing: ${stringify(prepared)}`);
    }

    if (!d.salt) {
      throw new Error(`prepared.delegation.salt missing: ${stringify(prepared)}`);
    }

    if (!Array.isArray(d.caveats)) {
      throw new Error(`prepared.delegation.caveats missing: ${stringify(prepared)}`);
    }

    const delegation = {
      delegate: getAddress(d.delegate),
      delegator: getAddress(d.delegator),
      authority: d.authority,
      caveats: d.caveats,
      salt: d.salt,
      signature: '0x' as Hex,
    };

    log('PREPARE_DELEGATION_USED_AS_IS', {
      backendDelegator: d.delegator,
      signingDelegator: delegation.delegator,
      smartAccountAddress,
      note: 'Proof signs prepared.delegation as returned by backend.',
      delegate: delegation.delegate,
      caveatsCount: delegation.caveats.length,
      salt: delegation.salt,
    });

    return {
      source: 'prepared.delegation as-is',
      delegation,
    };
  }

  if (prepared.delegate && prepared.delegationScope) {
    const delegation = createDelegation({
      environment: smartAccount.environment,
      from: smartAccountAddress,
      to: getAddress(prepared.delegate),
      scope: getScopeFromPrepare(prepared),
    });

    return {
      source: 'prepared.delegate + prepared.delegationScope',
      delegation,
    };
  }

  throw new Error(
    `Unsupported prepare response shape. Expected prepared.delegation OR prepared.delegate + prepared.delegationScope: ${stringify(
      prepared,
    )}`,
  );
}

function normalizeSignedDelegation(delegation: any, signature: Hex) {
  return {
    delegate: delegation.delegate ?? delegation.to,
    delegator: delegation.delegator ?? delegation.from,
    authority: delegation.authority,
    caveats: delegation.caveats ?? [],
    salt: delegation.salt,
    signature,
  };
}

async function maybeGetAdminExecutor() {
  try {
    const executor = await requestJson<any>('/admin/executor', {
      method: 'GET',
      headers: adminHeaders(),
    });

    log('ADMIN_EXECUTOR_LOADED', executor);
    return executor;
  } catch (err) {
    log('ADMIN_EXECUTOR_LOAD_FAILED_NON_FATAL', errorDetails(err));
    return null;
  }
}

async function assertHybridAlreadyDeployed(smartAccountAddress: Address) {
  const code = await publicClient.getCode({ address: smartAccountAddress });
  const deployed = Boolean(code && code !== '0x');

  log('HYBRID_SMART_ACCOUNT_DEPLOYMENT_CHECK', {
    smartAccountAddress,
    deployed,
    codeLength: code?.length ?? 0,
  });

  if (!deployed) {
    throw new Error(
      [
        `Hybrid Smart Account is not deployed: ${smartAccountAddress}`,
        '',
        'This no-Pimlico proof intentionally does not deploy Hybrid SA.',
        'Deploy it once using proof.html or the old Pimlico deploy script, then rerun this proof.',
        '',
        'Reason:',
        '- Hybrid SA deploy uses ERC-4337 UserOperation.',
        '- This proof uses backend 1Shot only for DCA execution after delegation is confirmed.',
      ].join('\n'),
    );
  }
}

function latestExecutionOf(installation: InstallationResponse): ExecutionRecord | undefined {
  const executions = Array.isArray(installation.executions) ? installation.executions : [];
  return executions[0];
}

function isTerminalExecutionStatus(status: unknown) {
  return status === 'confirmed' || status === 'failed';
}

async function pollInstallationAfterTrigger(params: {
  installationId: string;
  before: InstallationResponse;
}) {
  const { installationId, before } = params;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const beforeCount = Array.isArray(before.executions) ? before.executions.length : 0;
  const beforeLastExecutedAt = before.lastExecutedAt ?? '';

  let latest = before;

  while (Date.now() < deadline) {
    latest = await requestJson<InstallationResponse>(`/installations/${installationId}`, {
      method: 'GET',
    });

    const executions = Array.isArray(latest.executions) ? latest.executions : [];
    const latestExecution = executions[0];

    const hasNewExecution =
      executions.length > beforeCount ||
      Boolean(latest.lastExecutedAt && latest.lastExecutedAt !== beforeLastExecutedAt);

    log('INSTALLATION_POLL_TICK', {
      installationId,
      installationStatus: latest.status,
      beforeCount,
      executionsCount: executions.length,
      beforeLastExecutedAt,
      lastExecutedAt: latest.lastExecutedAt,
      hasNewExecution,
      latestExecution,
    });

    if (hasNewExecution && latestExecution && isTerminalExecutionStatus(latestExecution.status)) {
      return latest;
    }

    if (hasNewExecution && latestExecution?.status === 'submitted') {
      log('EXECUTION_SUBMITTED_WAITING_FOR_1SHOT_POLL', {
        oneShotTaskId: latestExecution.oneShotTaskId,
        txHash: latestExecution.txHash,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out polling installation execution for ${installationId}`);
}

async function main() {
  step('SkillWallet proof.ts — no Pimlico: prepare → confirm → admin trigger');

  log('CONFIG', {
    API_BASE_URL,
    ADMIN_API_KEY: 'REDACTED',
    BASE_SEPOLIA_RPC_URL: redactUrl(BASE_SEPOLIA_RPC_URL),
    DEFAULT_CHAIN_ID,
    PROOF_PRIVATE_KEY: 'REDACTED',
    PREFERRED_SKILL_ID,
    DEPLOY_SALT,
    USDC,
    WETH,
    SWAP_ROUTER_02,
    AMOUNT_IN_USDC_ATOMS,
    FEE_TIER,
    MAX_SLIPPAGE_BPS,
    POLL_AFTER_TRIGGER,
    POLL_INTERVAL_MS,
    POLL_TIMEOUT_MS,
  });

  step('0. Sanity check contracts and admin executor');

  await assertCode('USDC', USDC);
  await assertCode('WETH', WETH);
  await assertCode('SwapRouter02', SWAP_ROUTER_02);

  const adminExecutor = await maybeGetAdminExecutor();

  step('1. Load owner from PROOF_PRIVATE_KEY');

  const ownerAccount = privateKeyToAccount(PROOF_PRIVATE_KEY);
  const owner = getAddress(ownerAccount.address);

  log('OWNER_ACCOUNT_LOADED', { owner });

  step('2. Create Hybrid MetaMask Smart Account object');

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

  log('HYBRID_SMART_ACCOUNT_CREATED', {
    owner,
    smartAccountAddress,
    deploySalt: DEPLOY_SALT,
    keys: Object.keys(smartAccount as any),
    environment: (smartAccount as any).environment,
  });

  await logTokenBalance('OWNER_USDC_BEFORE', USDC, owner, 6);
  await logTokenBalance('OWNER_WETH_BEFORE', WETH, owner, 18);
  await logTokenBalance('SMART_ACCOUNT_USDC_BEFORE', USDC, smartAccountAddress, 6);
  await logTokenBalance('SMART_ACCOUNT_WETH_BEFORE', WETH, smartAccountAddress, 18);

  step('3. Require already-deployed Hybrid Smart Account');

  await assertHybridAlreadyDeployed(smartAccountAddress);

  step('4. GET /skills and select existing skill document');

  const skillsBody = await requestJson<any>('/skills');
  const skills = normalizeSkillsResponse(skillsBody);

  log('SKILLS_LOADED', { count: skills.length, skills });

  const selectedSkill = selectSkill(skills);
  if (!selectedSkill) throw new Error('No skill found from /skills');

  const skillId = getSkillIdentifier(selectedSkill);
  if (!skillId) {
    throw new Error(`Selected skill has no skillId/_id/id: ${stringify(selectedSkill)}`);
  }

  log('SKILL_SELECTED_FROM_BACKEND', {
    preferred: PREFERRED_SKILL_ID,
    selectedIdentifier: skillId,
    selectedSkill,
  });

  step('5. POST /installations/prepare');

  const dcaConfig = buildDcaConfig(smartAccountAddress, selectedSkill);

  const prepareInput = {
    userAddress: owner,
    smartAccountAddress,
    chainId: DEFAULT_CHAIN_ID,
    skillId,
    config: dcaConfig,
  };

  const prepared = await requestJson<PrepareResponse>('/installations/prepare', {
    method: 'POST',
    body: JSON.stringify(prepareInput),
  });

  log('PREPARE_DONE', {
    input: prepareInput,
    prepared,
    detectedShape: prepared.delegation
      ? 'prepared.delegation'
      : prepared.delegate && prepared.delegationScope
        ? 'prepared.delegate + prepared.delegationScope'
        : 'unknown',
  });

  if (prepared.executorAddress && adminExecutor?.address) {
    const preparedExecutor = getAddress(prepared.executorAddress);
    const adminExecutorAddress = getAddress(adminExecutor.address);

    if (preparedExecutor !== adminExecutorAddress) {
      log('EXECUTOR_ADDRESS_MISMATCH_WARNING', {
        preparedExecutor,
        adminExecutorAddress,
        note: 'If this is unexpected, backend may have restarted with a different EXECUTOR_PRIVATE_KEY.',
      });
    }
  }

  step('6. Build and sign delegation');

  const { source, delegation } = buildDelegationToSign({
    prepared,
    smartAccount,
    smartAccountAddress,
  });

  log('DELEGATION_TO_SIGN', { source, delegation });

  let delegationSignature: Hex;

  try {
    delegationSignature = await smartAccount.signDelegation({
      delegation: delegation as any,
    });

    log('DELEGATION_SIGNATURE_OK', {
      signature: delegationSignature,
      signaturePrefix: `${delegationSignature.slice(0, 22)}…`,
    });
  } catch (err) {
    log('DELEGATION_SIGNATURE_FAILED', errorDetails(err));
    throw err;
  }

  const signedDelegation = normalizeSignedDelegation(delegation, delegationSignature);

  log('SIGNED_DELEGATION_NORMALIZED', signedDelegation);

  step('7. POST /installations/confirm');

  const delegationSalt = prepared.salt ?? prepared.delegation?.salt;

  if (!delegationSalt) {
    throw new Error(`prepare did not return salt/delegation.salt: ${stringify(prepared)}`);
  }

  const confirmInput = {
    userAddress: owner,
    smartAccountAddress,
    skillId,
    signedDelegation,
    delegationSalt,
    parameters: dcaConfig,
  };

  const confirmed = await requestJson<InstallationResponse>('/installations/confirm', {
    method: 'POST',
    body: JSON.stringify(confirmInput),
  });

  const installationId = getInstallationId(confirmed);

  log('CONFIRM_DONE', {
    confirmInput,
    confirmed,
    installationId,
  });

  if (!installationId) {
    throw new Error(`confirm did not return installation id: ${stringify(confirmed)}`);
  }

  step('8. GET /installations/:id before trigger');

  const beforeTrigger = await requestJson<InstallationResponse>(
    `/installations/${installationId}`,
    {
      method: 'GET',
    },
  );

  log('INSTALLATION_BEFORE_TRIGGER', {
    installationId,
    installation: beforeTrigger,
    latestExecution: latestExecutionOf(beforeTrigger),
  });

  step('9. POST /admin/installations/:id/trigger');

  const triggerResult = await requestJson<any>(`/admin/installations/${installationId}/trigger`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ force: true }),
  });

  log('ADMIN_TRIGGER_DONE', {
    installationId,
    triggerResult,
  });

  step('10. GET /installations/:id after trigger');

  const afterTrigger = await requestJson<InstallationResponse>(`/installations/${installationId}`, {
    method: 'GET',
  });

  log('INSTALLATION_AFTER_TRIGGER', {
    installationId,
    installation: afterTrigger,
    latestExecution: latestExecutionOf(afterTrigger),
  });

  let finalInstallation = afterTrigger;

  if (POLL_AFTER_TRIGGER) {
    step('11. Poll /installations/:id for terminal execution');

    finalInstallation = await pollInstallationAfterTrigger({
      installationId,
      before: beforeTrigger,
    });

    log('INSTALLATION_FINAL', {
      installationId,
      installation: finalInstallation,
      latestExecution: latestExecutionOf(finalInstallation),
    });
  }

  step('12. Final balances');

  const ownerUsdcAfter = await logTokenBalance('OWNER_USDC_AFTER', USDC, owner, 6);
  const ownerWethAfter = await logTokenBalance('OWNER_WETH_AFTER', WETH, owner, 18);
  const smartUsdcAfter = await logTokenBalance(
    'SMART_ACCOUNT_USDC_AFTER',
    USDC,
    smartAccountAddress,
    6,
  );
  const smartWethAfter = await logTokenBalance(
    'SMART_ACCOUNT_WETH_AFTER',
    WETH,
    smartAccountAddress,
    18,
  );

  const latestExecution = latestExecutionOf(finalInstallation);

  step('PROOF SCRIPT FINISHED');

  log('SUMMARY', {
    owner,
    smartAccountAddress,
    selectedSkillId: skillId,
    installationId,
    triggerResult,
    latestExecution,
    balances: {
      owner: {
        usdc: formatUnits(ownerUsdcAfter, 6),
        weth: formatUnits(ownerWethAfter, 18),
      },
      smartAccount: {
        usdc: formatUnits(smartUsdcAfter, 6),
        weth: formatUnits(smartWethAfter, 18),
      },
    },
  });

  if (latestExecution?.status === 'failed') {
    throw new Error(
      `Execution failed: ${latestExecution.errorMessage ?? stringify(latestExecution)}`,
    );
  }

  if (latestExecution?.status !== 'confirmed') {
    log('NON_TERMINAL_OR_UNKNOWN_EXECUTION_STATUS_WARNING', {
      latestExecution,
      note: 'Script finished, but latest execution was not confirmed. Check backend logs and 1Shot status.',
    });
  }
}

main().catch((err) => {
  step('PROOF FAILED');
  log('ERROR', errorDetails(err));
  process.exit(1);
});
