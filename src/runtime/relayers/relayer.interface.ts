// 1Shot Relayer v2 — types. Wire shape from
// https://1shotapi.com/openrpc/openrpc.json (1.0.0). Public Relayer is
// permissionless; account-level auth (x-api-key + x-api-secret) is optional.

export type OneShotStatusCode = 100 | 110 | 200 | 400 | 500;
/** 100 Pending · 110 Submitted · 200 Confirmed · 400 Rejected · 500 Reverted */

export type OneShotStatusName = 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'reverted';

export type OneShotErrorCode = 4001 | 4200 | 4202 | 4204 | 4210 | 4211;
/** 4001 UserRejectedRequest · 4200 InsufficientPayment · 4202 UnsupportedPaymentToken
 * · 4204 QuoteExpired · 4210 InvalidAuthorizationList · 4211 SimulationFailed */

export interface OneShotAuthorizationListEntry {
  address: string;
  chainId: number | string;
  nonce: number | string;
  r: string;
  s: string;
  yParity: number | string;
}

export interface OneShotCaveat {
  enforcer: string;
  terms: string;
  args: string;
}

export interface OneShotDelegation {
  delegate: string;
  delegator: string;
  authority: string;
  caveats: OneShotCaveat[];
  salt: string;
  signature: string;
}

export interface OneShotExecution {
  target: string;
  value: string;
  data: string;
}

export interface OneShotDelegatedTransaction {
  permissionContext: OneShotDelegation[];
  executions: OneShotExecution[];
}

export interface Bundle7710 {
  chainId: number;
  transactions: OneShotDelegatedTransaction[];
  authorizationList?: OneShotAuthorizationListEntry[];
  context?: string;
  taskId?: string;
  destinationUrl?: string;
  memo?: string;
  /** Capabilities + fee quote + estimate captured at quote-time, used to
   *  post-validate that targetAddress / paymentToken haven't drifted. */
  raw?: {
    capabilities?: OneShotCapabilities;
    feeQuote?: OneShotFeeData;
    estimate?: OneShotEstimateResult;
  };
}

/** One per-chain block in a multichain bundle. Wire shape per OpenRPC
 *  `relayer_send7710TransactionMultichain` is an array of these (no
 *  top-level chainId, each entry carries its own). */
export type MultichainBundle7710Entry = {
  chainId: number;
  transactions: OneShotDelegatedTransaction[];
  authorizationList?: OneShotAuthorizationListEntry[];
  context?: string;
  taskId?: string;
  destinationUrl?: string;
  memo?: string;
};

export type MultichainBundle7710 = {
  transactions: MultichainBundle7710Entry[];
  authorizationList?: OneShotAuthorizationListEntry[];
  context?: string;
  taskId?: string;
  destinationUrl?: string;
  memo?: string;
};

export interface OneShotTokenInfo {
  address: string;
  decimals: number | string;
  symbol?: string;
  name?: string;
}

export interface OneShotChainCapability {
  chainId: string;
  feeCollector: string;
  targetAddress: string;
  tokens: OneShotTokenInfo[];
}

export interface OneShotCapabilities {
  chains: OneShotChainCapability[];
  raw?: Record<string, unknown>;
}

export interface OneShotFeeData {
  chainId: string;
  token: OneShotTokenInfo;
  rate: number;
  minFee: string;
  expiry: number;
  gasPrice: string;
  feeCollector: string;
  targetAddress: string;
  context: string;
  raw?: Record<string, unknown>;
}

export interface OneShotEstimateResult {
  success: boolean;
  paymentTokenAddress?: string;
  paymentChain?: number;
  gasUsed: Record<string, string>;
  requiredPaymentAmount: string;
  context: string;
  contextByChainId?: Record<string, string>;
  error?: string;
  raw?: Record<string, unknown>;
}

export interface OneShotSendResult {
  taskId: string;
  raw?: string;
}

export interface OneShotBaseStatus {
  id: string;
  chainId: string;
  createdAt: number;
  memo?: string;
}

export interface OneShotPendingStatus extends OneShotBaseStatus {
  status: 100;
}

export interface OneShotSubmittedStatus extends OneShotBaseStatus {
  status: 110;
  hash: string;
}

export interface OneShotStatusLog {
  address: string;
  topics: string[];
  data: string;
}

export interface OneShotStatusReceipt {
  blockHash: string;
  blockNumber: string;
  gasUsed: string;
  transactionHash: string;
  logs?: OneShotStatusLog[];
}

export interface OneShotConfirmedStatus extends OneShotBaseStatus {
  status: 200;
  receipt: OneShotStatusReceipt;
}

export interface OneShotRejectedStatus extends OneShotBaseStatus {
  status: 400;
  message: string;
  data?: unknown;
}

export interface OneShotRevertedStatus extends OneShotBaseStatus {
  status: 500;
  message?: string;
  data?: string;
}

export type OneShotStatusResult =
  | OneShotPendingStatus
  | OneShotSubmittedStatus
  | OneShotConfirmedStatus
  | OneShotRejectedStatus
  | OneShotRevertedStatus;

export interface RelayerStatusResult {
  taskId: string;
  statusCode: OneShotStatusCode;
  status: OneShotStatusName;
  chainId?: string;
  createdAt?: number;
  txHash?: string;
  receipt?: OneShotStatusReceipt;
  errorCode?: OneShotErrorCode;
  errorMessage?: string;
  raw?: OneShotStatusResult;
}

export interface OneShotWebhookTransactionReceipt {
  blockHash: string;
  blockNumber: number;
  contractAddress: string | null;
  cumulativeGasUsed: string;
  from: string;
  gasPrice: string;
  gasUsed: string;
  hash: string;
  index: number;
  logs: Array<{
    address: string;
    blockHash: string;
    blockNumber: number;
    data: string;
    index: number;
    topics: string[];
    transactionHash: string;
    transactionIndex: number;
  }>;
  logsBloom: string;
  status: number;
  to: string;
}

export interface OneShotWebhookData {
  businessId?: string;
  chain: number;
  logs?: Array<{
    args: unknown[];
    fragment: Record<string, unknown>;
    name: string;
    signature: string;
    topic: string;
  }>;
  transactionExecutionId?: string;
  transactionExecutionMemo?: string;
  transactionId: string;
  transactionReceipt: OneShotWebhookTransactionReceipt;
  userId?: string | null;
}

export interface OneShotWebhookPayload {
  eventName: string;
  data: OneShotWebhookData;
  timestamp: number;
  apiVersion: number;
  signature: string;
  raw?: unknown;
}

export interface RelaySubmissionResult {
  taskId: string;
  statusCode: OneShotStatusCode;
  status: OneShotStatusName;
  targetAddress: string;
  paymentToken: string;
  requiredPaymentAmount: string;
  context?: string;
  txHash?: string;
  externalStatusUrl?: string;
  errorCode?: OneShotErrorCode;
  errorMessage?: string;
  raw?: unknown;
}

export interface RelayInput {
  chainId: number;
  delegationManager: string;
  permissionContext: string;
  call: {
    to: string;
    data: string;
    value?: string;
  };
  context?: string;
  taskId?: string;
  destinationUrl?: string;
}

export interface RelayerInterface {
  getCapabilities(chainId: number): Promise<OneShotCapabilities>;
  getFeeData(bundle: Bundle7710): Promise<OneShotFeeData>;
  estimate7710Transaction(bundle: Bundle7710): Promise<OneShotEstimateResult>;
  estimate7710TransactionMultichain(bundle: MultichainBundle7710): Promise<OneShotEstimateResult>;
  send7710Transaction(bundle: Bundle7710): Promise<OneShotSendResult>;
  send7710TransactionMultichain(bundle: MultichainBundle7710): Promise<OneShotSendResult>;
  sendTransaction(bundle: {
    chainId: number;
    tx: { to: string; data: string; value?: string };
  }): Promise<OneShotSendResult>;
  sendTransactionMultichain(bundle: {
    transactions: Array<{
      chainId: number;
      tx: { to: string; data: string; value?: string };
    }>;
  }): Promise<string[]>;
  getStatus(taskId: string): Promise<RelayerStatusResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string, keyId?: string): Promise<boolean>;

  relayDelegatedExecution(input: RelayInput): Promise<RelaySubmissionResult>;
  getRelayStatus(taskId: string): Promise<RelayerStatusResult>;
}
