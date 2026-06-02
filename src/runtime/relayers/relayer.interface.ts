// =============================================================================
// 1Shot Relayer v2 — Types
// =============================================================================
// Real 1Shot JSON-RPC surface (permissionless, no API key). Status codes
// are numeric per the 1Shot spec. Error codes follow EIP-1193 conventions.
// =============================================================================

/** 1Shot task status codes (numeric) */
export type OneShotStatusCode = 100 | 110 | 200 | 400 | 500;
/**   100 — Pending (accepted, not yet on-chain)        */
/**   110 — Submitted (tx broadcast)                   */
/**   200 — Confirmed (tx mined)                       */
/**   400 — Rejected (pre-chain validation failed)     */
/**   500 — Reverted (tx reverted on-chain)            */

/** 1Shot / EIP-1193 error codes */
export type OneShotErrorCode = 4200 | 4202 | 4204 | 4210 | 4211;
/**   4200 — Invalid params (VALIDATION_ERROR)         */
/**   4202 — Resource not found (NOT_FOUND)            */
/**   4204 — Request rejected (RELAYER_ERROR)          */
/**   4210 — User rejected (RELAYER_ERROR)             */
/**   4211 — Insufficient funds (RELAYER_ERROR)        */

export type OneShotStatusName = 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'reverted';

// ---------------------------------------------------------------------------
// EIP-7710 bundle shapes
// ---------------------------------------------------------------------------

/** A single EIP-7710 execution inside a bundle */
export interface BundleExecution {
  target: string;
  callData: string;
  value?: string; // hex wei, defaults to 0x0
}

/** A single chain entry in an EIP-7710 bundle */
export interface BundleTransaction {
  chainId: number;
  permissionContext: string;
  executions: BundleExecution[];
}

/** EIP-1193 / EIP-7710 authorization list entry (typed loosely — relayer
 *  forwards it to the wallet/RPC, we don't interpret the contents). */
export type AuthorizationList = ReadonlyArray<Record<string, unknown>>;

/** Single-chain EIP-7710 bundle (chainId at top level) */
export interface Bundle7710 {
  chainId: number;
  transactions: Array<{
    permissionContext: string;
    executions: BundleExecution[];
  }>;
  authorizationList?: AuthorizationList;
  context?: string;
  taskId?: string;
  destinationUrl?: string;
}

/** Multichain EIP-7710 bundle (chainId per transaction) */
export interface MultichainBundle7710 {
  transactions: BundleTransaction[];
  authorizationList?: AuthorizationList;
  context?: string;
  taskId?: string;
  destinationUrl?: string;
}

// ---------------------------------------------------------------------------
// High-level input (used by RunnerService)
// ---------------------------------------------------------------------------

/** Input the runner hands to the relayer. The service builds the full
 *  EIP-7710 bundle from this + the relayer's own EIP-7710 contract. */
export interface RelayInput {
  chainId: number;
  delegationManager: string;
  permissionContext: string;
  call: {
    to: string;
    data: string;
    value?: string; // hex wei
  };
  context?: string; // opaque, app-supplied
  taskId?: string; // override; service generates one if omitted
}

// ---------------------------------------------------------------------------
// Submission / status results
// ---------------------------------------------------------------------------

export interface RelaySubmissionResult {
  taskId: string;
  statusCode: OneShotStatusCode;
  status: OneShotStatusName;
  /** Target contract the relayer is going to call (smart account or
   *  DelegationManager — relayer-decided). */
  targetAddress: string;
  paymentToken: string;
  requiredPaymentAmount: string; // atomic units, base-10 string
  context?: string;
  txHash?: string;
  externalStatusUrl?: string;
  errorCode?: OneShotErrorCode;
  errorMessage?: string;
}

export interface RelayerStatusResult {
  taskId: string;
  statusCode: OneShotStatusCode;
  status: OneShotStatusName;
  txHash?: string;
  errorCode?: OneShotErrorCode;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Webhook payload
// ---------------------------------------------------------------------------

/** JSON body 1Shot POSTs to the configured destination URL. The body is
 *  Ed25519-signed; signature is in the `signature` header (base64). */
export interface OneShotWebhookPayload {
  taskId: string;
  statusCode: OneShotStatusCode;
  txHash?: string;
  errorCode?: OneShotErrorCode;
  errorMessage?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Fee + capabilities
// ---------------------------------------------------------------------------

export interface OneShotCapabilities {
  networks: number[];
  methods: string[];
  features: string[];
  relayerAddress?: string;
}

export interface OneShotFeeData {
  paymentToken: string;
  requiredPaymentAmount: string;
  estimatedGas: string;
  chainId: number;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface RelayerInterface {
  // ----- low-level 1Shot JSON-RPC methods (1:1 with the wire) -----
  getCapabilities(): Promise<OneShotCapabilities>;
  getFeeData(bundle: Bundle7710): Promise<OneShotFeeData>;
  estimate7710Transaction(bundle: Bundle7710): Promise<RelaySubmissionResult>;
  estimate7710TransactionMultichain(bundle: MultichainBundle7710): Promise<RelaySubmissionResult>;
  send7710Transaction(bundle: Bundle7710): Promise<RelaySubmissionResult>;
  send7710TransactionMultichain(bundle: MultichainBundle7710): Promise<RelaySubmissionResult>;
  sendTransaction(bundle: {
    chainId: number;
    tx: { to: string; data: string; value?: string };
  }): Promise<RelaySubmissionResult>;
  sendTransactionMultichain(bundle: {
    transactions: Array<{
      chainId: number;
      tx: { to: string; data: string; value?: string };
    }>;
  }): Promise<RelaySubmissionResult>;
  getStatus(taskId: string): Promise<RelayerStatusResult>;

  // ----- high-level helpers used by the runner -----
  relayDelegatedExecution(input: RelayInput): Promise<RelaySubmissionResult>;
  getRelayStatus(taskId: string): Promise<RelayerStatusResult>;
}
