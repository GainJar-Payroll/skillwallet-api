import type {
  Address as StrictAddress,
  HexString as StrictHexString,
} from '../../common/types/evm';

type Address = StrictAddress | string;
type HexString = StrictHexString | string;

export type OneShotStatusCode = 100 | 110 | 200 | 400 | 500;
export type OneShotStatusName = 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'reverted';
export type OneShotErrorCode = 4001 | 4200 | 4202 | 4204 | 4210 | 4211;

export interface OneShotAuthorizationListEntry {
  address: Address;
  chainId: number | string;
  nonce: number | string;
  r: HexString;
  s: HexString;
  yParity: number | string;
}

export interface OneShotCaveat {
  enforcer: Address;
  terms: HexString;
  args: HexString;
}

export interface OneShotDelegation {
  delegate: Address;
  delegator: Address;
  authority: HexString;
  caveats: OneShotCaveat[];
  salt: HexString;
  signature: HexString;
}

export interface OneShotExecution {
  target: Address;
  value: string;
  callData?: HexString;
  data?: HexString;
}

export interface OneShotDelegatedTransaction {
  permissionContext: OneShotDelegation[];
  executions: OneShotExecution[];
}

export interface Bundle7710 {
  chainId: number;
  transactions: OneShotDelegatedTransaction[];
  authorizationList?: OneShotAuthorizationListEntry[];
  context?: string | Record<string, unknown>;
  taskId?: string;
  memo?: string;
  raw?: {
    capabilities?: OneShotCapabilities;
    feeQuote?: OneShotFeeData;
    estimate?: OneShotEstimateResult;
  };
}

export interface MultichainBundle7710Entry {
  chainId: number;
  transactions: OneShotDelegatedTransaction[];
  authorizationList?: OneShotAuthorizationListEntry[];
  context?: string;
  taskId?: string;
  memo?: string;
}

export interface MultichainBundle7710 {
  transactions: MultichainBundle7710Entry[];
  authorizationList?: OneShotAuthorizationListEntry[];
  context?: string;
  taskId?: string;
  memo?: string;
}

export interface OneShotTokenInfo {
  address: Address;
  decimals: number | string;
  symbol?: string;
  name?: string;
}

export interface OneShotChainCapability {
  chainId: number | string;
  feeCollector?: Address;
  targetAddress?: Address;
  tokens: OneShotTokenInfo[];
  name?: string;
  contracts?: {
    delegationManager?: Address;
    erc20SessionKeyRevoker?: Address;
  };
  features?: {
    send7710Transaction?: boolean;
    estimate7710Transaction?: boolean;
  };
  status?: string;
}

export interface OneShotCapabilities {
  chains: OneShotChainCapability[];
  data?: {
    chains?: OneShotChainCapability[];
    paymentTokens?: Array<{
      chainId: number;
      address: Address;
      symbol: string;
      decimals: number;
    }>;
  };
  meta?: {
    version?: string;
    environment?: string;
    capabilities?: string[];
  };
  raw?: Record<string, unknown>;
}

export interface OneShotFeeData {
  chainId: number | string;
  paymentToken?: Address | OneShotTokenInfo;
  token?: OneShotTokenInfo;
  requiredPaymentAmount?: string;
  minFee?: string;
  rate?: number;
  gasPrice?: string;
  feeCollector: Address;
  targetAddress: Address;
  expiry?: number;
  context?: string;
  meta?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface OneShotEstimateResult {
  success?: boolean;
  chainId?: number;
  paymentToken?: Address;
  feeCollector?: Address;
  estimatedGas?: string;
  paymentTokenAddress?: string;
  paymentChain?: number;
  gasUsed?: Record<string, string>;
  requiredPaymentAmount: string;
  context?: string;
  contextByChainId?: Record<string, string>;
  error?: string;
  meta?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface OneShotSendResult {
  taskId: string;
  status?: OneShotStatusName;
  statusCode?: OneShotStatusCode;
  txHash?: HexString;
  receipt?: {
    blockNumber?: string;
    blockHash?: HexString;
    gasUsed?: string;
    status?: string;
  };
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
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
  hash: HexString;
}

export interface OneShotStatusLog {
  address: Address;
  topics: string[];
  data: string;
}

export interface OneShotStatusReceipt {
  blockHash: HexString;
  blockNumber: string;
  gasUsed: string;
  transactionHash: HexString;
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
  status: OneShotStatusName;
  statusCode: OneShotStatusCode;
  chainId?: string;
  createdAt?: number;
  txHash?: HexString;
  receipt?: OneShotSendResult['receipt'];
  errorCode?: string | OneShotErrorCode;
  errorMessage?: string;
  raw?: OneShotStatusResult;
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
}

export interface IRelayer {
  readonly name?: string;
  getCapabilities(chainId: number): Promise<OneShotCapabilities>;
  getFeeData(
    params: { chainId: number; paymentToken: Address } | Bundle7710,
  ): Promise<OneShotFeeData>;
  estimate7710Transaction(
    params: { chainId: number; bundle: Bundle7710 } | Bundle7710,
  ): Promise<OneShotEstimateResult>;
  send7710Transaction(
    params: { chainId: number; bundle: Bundle7710 } | Bundle7710,
  ): Promise<OneShotSendResult>;
  getStatus(taskId: string): Promise<RelayerStatusResult>;
}
