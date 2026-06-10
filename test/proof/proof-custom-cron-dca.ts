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
import {
  findActiveOrPausedInstallation,
  getSkillParameterDefinitions,
  listInstallationsForUser,
  ProofParameterError,
  validateParametersClientSide,
} from './proof-helpers';

/**
 * test/proof/proof-custom-cron-dca.ts
 *
 * Proof for the Custom Cron DCA skill (custom-cron-dca-84532).
 *
 * Same flow as proof-ai-dca.ts but:
 *   1. Targets the Custom Cron DCA skill specifically
 *   2. Uses "every 2 seconds" cron expression for instant admin trigger
 *   3. No AI context verification (custom cron DCA has no AI analysis)
 *
 * Required env:
 *   PORT
 *   ADMIN_API_KEY
 *   BASE_SEPOLIA_RPC_URL
 *   DEFAULT_CHAIN_ID
 *   PROOF_PRIVATE_KEY
 *   ONESHOT_RELAYER_URL                   optional, defaults to 1Shot dev relayer
 *
 * Important:
 * - Delegation delegator MUST be Hybrid Smart Account address.
 * - Delegation delegate MUST be 1Shot relayer targetAddress.
 * - The executor EOA is NOT the delegation delegate for 1Shot flow.
 * - SKILL_ID_TARGET defaults to custom-cron-dca-84532, override via env.
 */

const PORT = Number(process.env.PORT ?? '3000');
const API_BASE_URL = `http://localhost:${PORT}`;

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL!;
const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID ?? '84532');
const PROOF_PRIVATE_KEY = process.env.PROOF_PRIVATE_KEY! as Hex;

const SKILL_ID_TARGET = process.env.SKILL_ID_TARGET ?? 'custom-cron-dca-84532';

const ONESHOT_RELAYER_URL =
  process.env.ONESHOT_RELAYER_URL ??
  process.env.RELAYER_URL ??
  'https://relayer.1shotapi.dev/relayers';

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

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;
const SWAP_ROUTER_02 = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as const;

const AMOUNT_IN_USDC_ATOMS = '100000';
const FEE_TIER = 3000;
const MAX_SLIPPAGE_BPS = 50;
const FREQUENCY = 'daily';

const POLL_AFTER_TRIGGER = true;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 180_000;

type JsonRpcResponse<T> = {
  jsonrpc?: '2.0';
  id?: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type OneShotChainInfo = {
  chainId?: string | number;
  feeCollector?: Address;
  targetAddress?: Address;
  tokens?: unknown[];
  [key: string]: unknown;
};

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
    const error = new Error(Array.isArray(message) ? message.join(', ') : String(message));
    Object.assign(error, { status: res.status, body });
    throw error;
  }

  return (body?.payload ?? body?.data ?? body) as T;
}

async function oneShotRpc<T>(method: string, params: unknown, id = 1): Promise<T> {
  const body = {
    jsonrpc: '2.0' as const,
    id,
    method,
    params,
  };

  log('ONESHOT_RPC_REQUEST', {
    url: redactUrl(ONESHOT_RELAYER_URL),
    method,
    params,
  });

  const res = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  let json: JsonRpcResponse<T>;

  try {
    json = JSON.parse(text) as JsonRpcResponse<T>;
  } catch {
    throw new Error(`1Shot invalid JSON response: ${text}`);
  }

  log('ONESHOT_RPC_RESPONSE', {
    url: redactUrl(ONESHOT_RELAYER_URL),
    status: res.status,
    ok: res.ok,
    body: json,
  });

  if (!res.ok) {
    throw new Error(`1Shot HTTP ${res.status}: ${stringify(json)}`);
  }

  if (json.error) {
    throw new Error(
      `1Shot JSON-RPC ${json.error.code}: ${json.error.message} ${stringify(
        json.error.data ?? '',
      )}`,
    );
  }

  if (json.result === undefined) {
    throw new Error(`1Shot missing result: ${stringify(json)}`);
  }

  return json.result;
}

async function getOneShotChainInfo(chainId: number): Promise<OneShotChainInfo> {
  const capabilities = await oneShotRpc<Record<string, unknown>>(
    'relayer_getCapabilities',
    [String(chainId)],
    1,
  );

  const direct = capabilities[String(chainId)] as OneShotChainInfo | undefined;

  if (direct?.targetAddress) {
    return {
      chainId,
      ...direct,
      targetAddress: getAddress(direct.targetAddress),
      feeCollector: direct.feeCollector ? getAddress(direct.feeCollector) : undefined,
    };
  }

  const chains = (capabilities as any)?.chains ?? [];
  const found = chains.find((item: any) => String(item.chainId) === String(chainId));

  if (found?.targetAddress) {
    return {
      ...found,
      targetAddress: getAddress(found.targetAddress),
      feeCollector: found.feeCollector ? getAddress(found.feeCollector) : undefined,
    };
  }

  throw new Error(
    `1Shot does not expose targetAddress for chainId=${chainId}. Capabilities=${stringify(
      capabilities,
    )}`,
  );
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
  return skill?.skillId;
}

function findSkillById(skills: any[], targetId: string) {
  const found = skills.find((skill) => skill.skillId === targetId);
  if (!found) {
    throw new Error(`Skill ${targetId} not found in /skills response`);
  }
  return found;
}

function buildDcaConfig(smartAccountAddress: Address, selectedSkill: any) {
  const amountDefault = selectedSkill?.parameters?.find?.(
    (param: any) => param?.key === 'amountUsdc',
  )?.defaultValue;

  return {
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

function getAlreadyInstalledId(err: unknown) {
  const message = String((err as { message?: unknown })?.message ?? '');
  const match = message.match(/installationId=([a-fA-F0-9]+)/);
  return match?.[1] ?? '';
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
  oneShotTargetAddress: Address;
}) {
  const { prepared, smartAccount, smartAccountAddress, oneShotTargetAddress } = params;

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

    const backendDelegator = getAddress(d.delegator);
    const expectedDelegator = getAddress(smartAccountAddress);

    if (backendDelegator !== expectedDelegator) {
      throw new Error(
        [
          'prepared.delegation.delegator mismatch.',
          `Backend returned delegator=${backendDelegator}`,
          `Expected Hybrid Smart Account=${expectedDelegator}`,
          '',
          'Backend /installations/prepare must use:',
          '  from: smartAccountAddress',
          'not:',
          '  from: userAddress / EOA',
        ].join('\n'),
      );
    }

    const backendDelegate = getAddress(d.delegate);
    const expectedDelegate = getAddress(oneShotTargetAddress);

    if (backendDelegate !== expectedDelegate) {
      throw new Error(
        [
          'prepared.delegation.delegate mismatch.',
          `Backend returned delegate=${backendDelegate}`,
          `Expected 1Shot targetAddress=${expectedDelegate}`,
          '',
          'This is the real cause of the 1Shot error:',
          `"First delegation's delegate must be the relayer Target wallet".`,
          '',
          'Backend /installations/prepare must create delegation with:',
          '  to: oneShot chainInfo.targetAddress',
          'not:',
          '  to: executorService.getAddress()',
        ].join('\n'),
      );
    }

    const delegation = {
      delegate: backendDelegate,
      delegator: backendDelegator,
      authority: d.authority,
      caveats: d.caveats,
      salt: d.salt,
      signature: '0x' as Hex,
    };

    log('PREPARE_DELEGATION_USED_AS_IS', {
      backendDelegator: d.delegator,
      signingDelegator: delegation.delegator,
      smartAccountAddress,
      backendDelegate,
      oneShotTargetAddress,
      note: 'Proof signs prepared.delegation exactly as returned by backend. No silent override.',
      caveatsCount: delegation.caveats.length,
      salt: delegation.salt,
    });

    return {
      source: 'prepared.delegation as-is',
      delegation,
    };
  }

  if (prepared.delegate && prepared.delegationScope) {
    const backendDelegate = getAddress(prepared.delegate);
    const expectedDelegate = getAddress(oneShotTargetAddress);

    if (backendDelegate !== expectedDelegate) {
      throw new Error(
        [
          'prepared.delegate mismatch.',
          `Backend returned delegate=${backendDelegate}`,
          `Expected 1Shot targetAddress=${expectedDelegate}`,
          '',
          'Backend must return the 1Shot target wallet as delegate.',
        ].join('\n'),
      );
    }

    const delegation = createDelegation({
      environment: smartAccount.environment,
      from: smartAccountAddress,
      to: backendDelegate,
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
  step('Proof: Custom Cron DCA — prepare → confirm → admin trigger → verify execution');

  log('CONFIG', {
    API_BASE_URL,
    ADMIN_API_KEY: 'REDACTED',
    BASE_SEPOLIA_RPC_URL: redactUrl(BASE_SEPOLIA_RPC_URL),
    ONESHOT_RELAYER_URL: redactUrl(ONESHOT_RELAYER_URL),
    DEFAULT_CHAIN_ID,
    PROOF_PRIVATE_KEY: 'REDACTED',
    SKILL_ID_TARGET,
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

  step('0. Sanity check contracts, admin executor, and 1Shot target');

  await assertCode('USDC', USDC);
  await assertCode('WETH', WETH);
  await assertCode('SwapRouter02', SWAP_ROUTER_02);

  const oneShotChainInfo = await getOneShotChainInfo(DEFAULT_CHAIN_ID);
  const oneShotTargetAddress = getAddress(oneShotChainInfo.targetAddress!);

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

  step('4. GET /skills and select Custom Cron DCA skill');

  const skillsBody = await requestJson<any>('/skills');
  const skills = normalizeSkillsResponse(skillsBody);

  log('SKILLS_LOADED', { count: skills.length, skills });

  const selectedSkill = findSkillById(skills, SKILL_ID_TARGET);
  if (!selectedSkill) throw new Error('No skill found from /skills');

  const skillId = getSkillIdentifier(selectedSkill);
  if (!skillId) {
    throw new Error(`Selected skill has no skillId/_id/id: ${stringify(selectedSkill)}`);
  }

  log('SKILL_SELECTED_FROM_BACKEND', {
    target: SKILL_ID_TARGET,
    selectedIdentifier: skillId,
    selectedSkill,
  });

  step('4a. Client-side validate chosen parameters against skill.parameters');

  const skillDefinitions = getSkillParameterDefinitions(selectedSkill);

  const dcaParameters = [
    { key: 'cronSchedule', value: '*/2 * * * * *' },
    { key: 'outputToken', value: 'weth' },
    { key: 'amountUsdc', value: AMOUNT_IN_USDC_ATOMS },
  ];

  let normalizedParameters: Record<string, unknown>;
  try {
    normalizedParameters = validateParametersClientSide(skillDefinitions, dcaParameters);
  } catch (err) {
    if (err instanceof ProofParameterError) {
      throw new Error(
        `Client-side parameter validation failed for skill=${skillId} key=${err.key ?? '?'}: ${err.message}`,
      );
    }
    throw err;
  }

  log('CLIENT_SIDE_PARAMETERS_VALIDATED', {
    skillId,
    submitted: dcaParameters,
    normalized: normalizedParameters,
  });

  step('4b. Check GET /installations for existing (user, smartAccount, skillId)');

  const existingInstallations = await listInstallationsForUser(requestJson, {
    userAddress: owner,
    chainId: DEFAULT_CHAIN_ID,
    smartAccountAddress,
  });

  const existing = findActiveOrPausedInstallation(existingInstallations, {
    userAddress: owner,
    smartAccountAddress,
    skillId,
  });

  log('EXISTING_INSTALLATION_CHECK', {
    skillId,
    installationsCount: existingInstallations.length,
    existing: existing ?? null,
  });

  step('5. POST /installations/prepare');

  const prepareInput = {
    userAddress: owner,
    smartAccountAddress,
    chainId: DEFAULT_CHAIN_ID,
    skillId,
    parameters: dcaParameters,
  };

  let installationId = '';

  if (existing) {
    installationId = getInstallationId(existing);
    if (!installationId) {
      throw new Error(`Existing installation has no id: ${stringify(existing)}`);
    }
    log('SKIPPING_PREPARE_CONFIRM_INSTALLATION_ALREADY_PRESENT', {
      skillId,
      installationId,
      status: existing.status,
    });
  } else
    try {
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

      step('6. Build and sign delegation');

      const { source, delegation } = buildDelegationToSign({
        prepared,
        smartAccount,
        smartAccountAddress,
        oneShotTargetAddress,
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
        chainId: DEFAULT_CHAIN_ID,
        skillId,
        signedDelegation,
        delegationSalt,
        parameters: dcaParameters,
      };

      const confirmed = await requestJson<InstallationResponse>('/installations/confirm', {
        method: 'POST',
        body: JSON.stringify(confirmInput),
      });

      installationId = getInstallationId(confirmed);

      log('CONFIRM_DONE', {
        confirmInput,
        confirmed,
        installationId,
      });

      if (!installationId) {
        throw new Error(`confirm did not return installation id: ${stringify(confirmed)}`);
      }
    } catch (err) {
      const existingInstallationId = getAlreadyInstalledId(err);
      if (!existingInstallationId) throw err;

      installationId = existingInstallationId;
      log('INSTALLATION_ALREADY_EXISTS_REUSED', { installationId, error: errorDetails(err) });
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
    targetSkillId: SKILL_ID_TARGET,
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
