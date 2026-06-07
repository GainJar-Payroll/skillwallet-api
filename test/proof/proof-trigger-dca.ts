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

const PORT = Number(process.env.PORT ?? '3000');
const API_BASE_URL = `http://localhost:${PORT}`;

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID ?? '84532');
const PROOF_PRIVATE_KEY = process.env.PROOF_PRIVATE_KEY! as Hex;
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
const EVENT_SKILL_ID = 'usdc-inbound-dca-84532' as const;
const TRANSFER_EVENT_SIGNATURE = 'Transfer(address indexed from,address indexed to,uint256 value)' as const;
const INBOUND_USDC_ATOMS = process.env.PROOF_INBOUND_USDC_ATOMS ?? '1000000';

const CHOSEN_PARAMETERS = {
  outputToken: (process.env.PROOF_OUTPUT_TOKEN ?? 'weth') as 'weth' | 'cbBtc',
  spendMode: (process.env.PROOF_SPEND_MODE ?? 'percent-of-inbound') as
    | 'fixed'
    | 'percent-of-inbound',
  amountPerRun: process.env.PROOF_AMOUNT_PER_RUN ?? '100000',
  percentOfInboundBps: process.env.PROOF_PERCENT_OF_INBOUND_BPS ?? '5000',
  dailySpendLimit: process.env.PROOF_DAILY_SPEND_LIMIT ?? '900000',
};

const POLL_INTERVAL_MS = Number(process.env.PROOF_POLL_INTERVAL_MS ?? '5000');
const POLL_TIMEOUT_MS = Number(process.env.PROOF_POLL_TIMEOUT_MS ?? '180000');

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
  executionId?: string;
  executedAt?: string;
  completedAt?: string;
  status?: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'skipped' | string;
  oneShotTaskId?: string;
  txHash?: string;
  errorMessage?: string;
  skippedReason?: string;
  trigger?: {
    type?: string;
    event?: {
      chainId?: number;
      contractAddress?: string;
      eventSignature?: string;
      txHash?: string;
      logIndex?: number;
      blockNumber?: string;
      args?: Record<string, unknown>;
    };
  };
  spend?: {
    tokenAddress?: string;
    requestedAmount?: string;
    actualAmount?: string;
    dailyLimit?: string;
    periodKey?: string;
    reservationId?: string;
  };
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
  parameters?: Record<string, unknown>;
  status?: string;
  executions?: ExecutionRecord[];
  lastExecutedAt?: string;
  nextExecutionAt?: string;
  [key: string]: unknown;
};

type ExecutionsResponse = {
  installationId: string;
  data: ExecutionRecord[];
};

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC_URL),
});

const ownerAccount = privateKeyToAccount(PROOF_PRIVATE_KEY);

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
          ...(nested as Record<string, unknown>),
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
  const e = err as Record<string, any>;

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

  let parsedBody: unknown;

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

  log('HTTP_RESPONSE', { url, status: res.status, ok: res.ok, body });

  if (!res.ok) {
    const message = body?.error?.message ?? body?.message ?? body?.raw ?? `HTTP ${res.status}`;
    const error = new Error(Array.isArray(message) ? message.join(', ') : String(message));
    Object.assign(error, { status: res.status, body });
    throw error;
  }

  return (body?.payload ?? body?.data ?? body) as T;
}

async function oneShotRpc<T>(method: string, params: unknown, id = 1): Promise<T> {
  const body = { jsonrpc: '2.0' as const, id, method, params };

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

  if (!res.ok) throw new Error(`1Shot HTTP ${res.status}: ${stringify(json)}`);
  if (json.error) {
    throw new Error(
      `1Shot JSON-RPC ${json.error.code}: ${json.error.message} ${stringify(json.error.data ?? '')}`,
    );
  }
  if (json.result === undefined) throw new Error(`1Shot missing result: ${stringify(json)}`);

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

  const chains = (capabilities as { chains?: Array<Record<string, unknown>> })?.chains ?? [];
  const found = chains.find((item) => String(item.chainId) === String(chainId)) as
    | OneShotChainInfo
    | undefined;

  if (found?.targetAddress) {
    return {
      ...found,
      targetAddress: getAddress(found.targetAddress),
      feeCollector: found.feeCollector ? getAddress(found.feeCollector) : undefined,
    };
  }

  throw new Error(
    `1Shot does not expose targetAddress for chainId=${chainId}. Capabilities=${stringify(capabilities)}`,
  );
}

async function assertCode(label: string, address: Address) {
  const code = await publicClient.getCode({ address });
  if (!code || code === '0x') throw new Error(`${label} has no code at ${address}`);
  log(`${label}_CODE_OK`, { address, codeLength: code.length });
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
  log(label, { owner, token, raw: balance, formatted: formatUnits(balance, decimals) });
  return balance;
}

function normalizeSkillsResponse(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.skills)) return body.skills;
  return [];
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
  } as const;
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

    if (!d.delegate || !d.delegator || !d.authority || !d.salt || !Array.isArray(d.caveats)) {
      throw new Error(`prepare delegation shape incomplete: ${stringify(prepared)}`);
    }

    const backendDelegator = getAddress(d.delegator);
    const expectedDelegator = getAddress(smartAccountAddress);
    if (backendDelegator !== expectedDelegator) {
      throw new Error(
        `prepared.delegation.delegator mismatch. got=${backendDelegator} expected=${expectedDelegator}`,
      );
    }

    const backendDelegate = getAddress(d.delegate);
    const expectedDelegate = getAddress(oneShotTargetAddress);
    if (backendDelegate !== expectedDelegate) {
      throw new Error(
        `prepared.delegation.delegate mismatch. got=${backendDelegate} expected=${expectedDelegate}`,
      );
    }

    return {
      source: 'prepared.delegation as-is',
      delegation: {
        delegate: backendDelegate,
        delegator: backendDelegator,
        authority: d.authority,
        caveats: d.caveats,
        salt: d.salt,
        signature: '0x' as Hex,
      },
    };
  }

  if (prepared.delegate && prepared.delegationScope) {
    const backendDelegate = getAddress(prepared.delegate);
    const expectedDelegate = getAddress(oneShotTargetAddress);
    if (backendDelegate !== expectedDelegate) {
      throw new Error(`prepared.delegate mismatch. got=${backendDelegate} expected=${expectedDelegate}`);
    }

    return {
      source: 'prepared.delegate + prepared.delegationScope',
      delegation: createDelegation({
        environment: smartAccount.environment,
        from: smartAccountAddress,
        to: backendDelegate,
        scope: getScopeFromPrepare(prepared),
      }),
    };
  }

  throw new Error(`Unsupported prepare response shape: ${stringify(prepared)}`);
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
        'Deploy it once using proof.html or the older proof flow, then rerun this trigger proof.',
      ].join('\n'),
    );
  }
}

function assertParametersPersisted(installation: InstallationResponse) {
  const parameters = installation.parameters ?? {};
  for (const [key, value] of Object.entries(CHOSEN_PARAMETERS)) {
    if (String(parameters[key]) !== String(value)) {
      throw new Error(
        `Installation parameter mismatch for ${key}: got=${parameters[key]} expected=${value}`,
      );
    }
  }
}

function hasRequiredExecutionMetadata(execution: ExecutionRecord, smartAccountAddress: Address) {
  const triggerType = execution.trigger?.type;
  const event = execution.trigger?.event;
  const spend = execution.spend;

  return (
    triggerType === 'event-trigger' &&
    getAddress(String(event?.args?.to ?? '0x0000000000000000000000000000000000000000')) ===
      getAddress(smartAccountAddress) &&
    String(spend?.requestedAmount ?? '').length > 0 &&
    String(spend?.actualAmount ?? '').length > 0 &&
    String(spend?.dailyLimit ?? '').length > 0 &&
    String(spend?.periodKey ?? '').length > 0
  );
}

async function pollExecutionHistory(params: {
  installationId: string;
  smartAccountAddress: Address;
  expectedTriggerType: 'event-trigger';
}) {
  const { installationId, smartAccountAddress, expectedTriggerType } = params;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const historyResponse = await requestJson<ExecutionsResponse | ExecutionRecord[]>(
      `/installations/${installationId}/executions`,
      {
        method: 'GET',
      },
    );
    const executions = Array.isArray(historyResponse) ? historyResponse : historyResponse.data;
    const history = Array.isArray(historyResponse)
      ? { installationId, data: executions }
      : historyResponse;

    const match = executions.find((execution) => {
      if (execution.trigger?.type !== expectedTriggerType) return false;
      return hasRequiredExecutionMetadata(execution, smartAccountAddress);
    });

    log('EXECUTION_HISTORY_POLL_TICK', {
      installationId,
      executionsCount: executions.length,
      latestExecution: executions[0],
      matchedExecution: match,
    });

    if (match) {
      return { history, execution: match };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for execution history metadata on installation ${installationId}`);
}

function logTransferInstructions(params: { owner: Address; smartAccountAddress: Address }) {
  log('WAITING_FOR_ONCHAIN_USDC_TRANSFER', {
    instruction: 'Send USDC on Base Sepolia to the smartAccountAddress. Backend EventRunnerService must catch the Transfer event and execute the skill.',
    chainId: DEFAULT_CHAIN_ID,
    token: USDC,
    suggestedAmountAtoms: INBOUND_USDC_ATOMS,
    fromAnyAddress: true,
    proofOwnerAddress: params.owner,
    smartAccountAddress: params.smartAccountAddress,
    expectedEventSignature: TRANSFER_EVENT_SIGNATURE,
    expectedHistoryTriggerType: 'event-trigger',
    pollTimeoutMs: POLL_TIMEOUT_MS,
  });
}

async function main() {
  step('SkillWallet proof-trigger-dca.ts — seed → prepare → confirm → event trigger → executions history');

  log('CONFIG', {
    API_BASE_URL,
    ADMIN_API_KEY: 'REDACTED',
    BASE_SEPOLIA_RPC_URL: redactUrl(BASE_SEPOLIA_RPC_URL),
    ONESHOT_RELAYER_URL: redactUrl(ONESHOT_RELAYER_URL),
    DEFAULT_CHAIN_ID,
    PROOF_PRIVATE_KEY: 'REDACTED',
    DEPLOY_SALT,
    EVENT_SKILL_ID,
    USDC,
    WETH,
    SWAP_ROUTER_02,
    mode: 'watch-event-trigger',
    INBOUND_USDC_ATOMS,
    CHOSEN_PARAMETERS,
    POLL_INTERVAL_MS,
    POLL_TIMEOUT_MS,
  });

  step('0. Sanity check contracts, admin executor, and 1Shot target');
  await assertCode('USDC', USDC);
  await assertCode('WETH', WETH);
  await assertCode('SwapRouter02', SWAP_ROUTER_02);
  const adminExecutor = await maybeGetAdminExecutor();
  const oneShotChainInfo = await getOneShotChainInfo(DEFAULT_CHAIN_ID);
  const oneShotTargetAddress = getAddress(oneShotChainInfo.targetAddress!);

  log('ONESHOT_CHAIN_INFO_LOADED', {
    chainId: DEFAULT_CHAIN_ID,
    oneShotChainInfo,
    oneShotTargetAddress,
    adminExecutorAddress: adminExecutor?.address,
  });

  step('1. Load owner and create Hybrid Smart Account object');
  const owner = getAddress(ownerAccount.address);
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
    environment: (smartAccount as any).environment,
  });

  await logTokenBalance('OWNER_USDC_BEFORE', USDC, owner, 6);
  await logTokenBalance('SMART_ACCOUNT_USDC_BEFORE', USDC, smartAccountAddress, 6);
  await assertHybridAlreadyDeployed(smartAccountAddress);

  step('2. Seed built-in skills and select the event-trigger skill');
  const seeded = await requestJson<{ seeded: string[] }>('/admin/skills/seed', {
    method: 'POST',
    headers: adminHeaders(),
  });

  if (!seeded.seeded.includes('Generic DCA') || !seeded.seeded.includes('USDC Inbound DCA')) {
    throw new Error(`Seed response missing required built-ins: ${stringify(seeded)}`);
  }

  const skillsBody = await requestJson<any>('/skills');
  const skills = normalizeSkillsResponse(skillsBody);
  const selectedSkill = skills.find((skill) => skill.skillId === EVENT_SKILL_ID);
  if (!selectedSkill) throw new Error(`Could not find ${EVENT_SKILL_ID} in /skills response`);

  log('SKILL_SELECTED_FROM_BACKEND', { selectedSkill });

  step('3. POST /installations/prepare');
  const prepareInput = {
    userAddress: owner,
    smartAccountAddress,
    chainId: DEFAULT_CHAIN_ID,
    skillId: EVENT_SKILL_ID,
    parameters: CHOSEN_PARAMETERS,
  };

  let installationId = '';

  try {
    const prepared = await requestJson<PrepareResponse>('/installations/prepare', {
      method: 'POST',
      body: JSON.stringify(prepareInput),
    });

    log('PREPARE_DONE', { input: prepareInput, prepared });

    step('4. Build and sign delegation');
    const { source, delegation } = buildDelegationToSign({
      prepared,
      smartAccount,
      smartAccountAddress,
      oneShotTargetAddress,
    });
    log('DELEGATION_TO_SIGN', { source, delegation });

    const delegationSignature = await smartAccount.signDelegation({ delegation: delegation as any });
    const signedDelegation = normalizeSignedDelegation(delegation, delegationSignature);
    log('SIGNED_DELEGATION_NORMALIZED', signedDelegation);

    step('5. POST /installations/confirm');
    const delegationSalt = prepared.salt ?? prepared.delegation?.salt;
    if (!delegationSalt) throw new Error(`prepare did not return salt/delegation.salt: ${stringify(prepared)}`);

    const confirmInput = {
      userAddress: owner,
      smartAccountAddress,
      chainId: DEFAULT_CHAIN_ID,
      skillId: EVENT_SKILL_ID,
      signedDelegation,
      delegationSalt,
      parameters: CHOSEN_PARAMETERS,
    };

    const confirmed = await requestJson<InstallationResponse>('/installations/confirm', {
      method: 'POST',
      body: JSON.stringify(confirmInput),
    });
    installationId = getInstallationId(confirmed);
    if (!installationId) throw new Error(`confirm did not return installation id: ${stringify(confirmed)}`);

    log('CONFIRM_DONE', { confirmInput, confirmed, installationId });
    assertParametersPersisted(confirmed);
  } catch (err) {
    const existingInstallationId = getAlreadyInstalledId(err);
    if (!existingInstallationId) throw err;

    installationId = existingInstallationId;
    log('INSTALLATION_ALREADY_EXISTS_REUSED', { installationId, error: errorDetails(err) });
  }

  step('6. Confirm installation and parameters before triggering');
  const installationBeforeTrigger = await requestJson<InstallationResponse>(`/installations/${installationId}`, {
    method: 'GET',
  });
  assertParametersPersisted(installationBeforeTrigger);

  log('INSTALLATION_BEFORE_TRIGGER', { installationId, installation: installationBeforeTrigger });

  step('7. Watch for real onchain USDC Transfer event');
  logTransferInstructions({ owner, smartAccountAddress });

  step('8. Poll GET /installations/:id/executions for proof-ready event-trigger + spend metadata');
  const expectedTriggerType = 'event-trigger' as const;
  const { history, execution } = await pollExecutionHistory({
    installationId,
    smartAccountAddress,
    expectedTriggerType,
  });

  const expectedTo = getAddress(smartAccountAddress);
  const actualTo = getAddress(String(execution.trigger?.event?.args?.to));
  if (actualTo !== expectedTo) {
    throw new Error(`Execution event.to mismatch: got=${actualTo} expected=${expectedTo}`);
  }

  if (String(execution.spend?.dailyLimit) !== String(CHOSEN_PARAMETERS.dailySpendLimit)) {
    throw new Error(
      `Execution spend.dailyLimit mismatch: got=${execution.spend?.dailyLimit} expected=${CHOSEN_PARAMETERS.dailySpendLimit}`,
    );
  }

  log('EXECUTION_HISTORY_ASSERTED', {
    installationId,
    executionsCount: history.data.length,
    matchedExecution: execution,
  });

  step('9. Final balances and summary');
  const ownerUsdcAfter = await logTokenBalance('OWNER_USDC_AFTER', USDC, owner, 6);
  const smartUsdcAfter = await logTokenBalance('SMART_ACCOUNT_USDC_AFTER', USDC, smartAccountAddress, 6);

  log('SUMMARY', {
    owner,
    smartAccountAddress,
    installationId,
    selectedSkillId: EVENT_SKILL_ID,
    mode: 'watch-event-trigger',
    chosenParameters: CHOSEN_PARAMETERS,
    matchedExecution: execution,
    balances: {
      ownerUsdc: formatUnits(ownerUsdcAfter, 6),
      smartAccountUsdc: formatUnits(smartUsdcAfter, 6),
    },
  });
}

main().catch((err) => {
  step('PROOF FAILED');
  log('ERROR', errorDetails(err));
  process.exit(1);
});
