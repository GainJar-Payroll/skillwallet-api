import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PimlicoUserOperation {
  sender: `0x${string}`;
  nonce: string;
  factory: `0x${string}`;
  factoryData: `0x${string}`;
  callData: `0x${string}`;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymaster?: `0x${string}`;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterData?: `0x${string}`;
  signature: `0x${string}`;
}

export interface PimlicoPaymasterStubData {
  paymaster: `0x${string}`;
  paymasterData: `0x${string}`;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
  callGasLimit?: string;
}

export interface PimlicoPaymasterData {
  paymaster: `0x${string}`;
  paymasterData: `0x${string}`;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
}

export interface PimlicoGasEstimate {
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
}

export interface PimlicoUserOperationReceipt {
  userOpHash: `0x${string}`;
  entryPoint: `0x${string}`;
  sender: `0x${string}`;
  nonce: string;
  paymaster: `0x${string}`;
  actualGasUsed: string;
  actualGasCost: string;
  success: boolean;
  receipt: {
    transactionHash: `0x${string}`;
    blockNumber: string;
    blockHash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}`;
    gasUsed: string;
  };
}

export interface PimlicoSupportedEntryPoints {
  entryPoints: `0x${string}`[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as `0x${string}`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PimlicoService {
  private readonly logger = new Logger(PimlicoService.name);
  private readonly paymasterUrl: string;
  private readonly bundlerUrl: string;
  private readonly sponsorshipPolicy: string;

  constructor(private readonly config: ConfigService) {
    this.paymasterUrl = this.config.get<string>('pimlico.paymasterUrl')!;
    this.bundlerUrl = this.config.get<string>('pimlico.bundlerUrl')!;
    this.sponsorshipPolicy = this.config.get<string>('pimlico.sponsorshipPolicy') ?? '';
  }

  // -----------------------------------------------------------------------
  // Paymaster (ERC-7677)
  // -----------------------------------------------------------------------

  /**
   * Get stub paymaster data — used during gas estimation.
   * Returns a dummy paymasterAndData that satisfies gas checks.
   */
  async getPaymasterStubData(
    userOp: Partial<PimlicoUserOperation>,
    entryPoint: `0x${string}` = ENTRY_POINT_V07,
    policyId?: string,
  ): Promise<PimlicoPaymasterStubData> {
    const params: Record<string, unknown> = {
      entryPoint,
      userOperation: this.sanitizeUserOp(userOp),
    };
    if (policyId) {
      params.sponsorshipPolicyId = policyId;
    }
    return this.paymasterRpc<PimlicoPaymasterStubData>('pm_getPaymasterStubData', [params]);
  }

  /**
   * Get real paymaster data — called after gas estimation with complete userOp.
   * Returns the real paymasterAndData to include in the UserOperation.
   */
  async getPaymasterData(
    userOp: Partial<PimlicoUserOperation>,
    entryPoint: `0x${string}` = ENTRY_POINT_V07,
    policyId?: string,
  ): Promise<PimlicoPaymasterData> {
    const params: Record<string, unknown> = {
      entryPoint,
      userOperation: this.sanitizeUserOp(userOp),
    };
    if (policyId) {
      params.sponsorshipPolicyId = policyId;
    }
    return this.paymasterRpc<PimlicoPaymasterData>('pm_getPaymasterData', [params]);
  }

  // -----------------------------------------------------------------------
  // Bundler (ERC-4337)
  // -----------------------------------------------------------------------

  /**
   * Estimate gas for a UserOperation.
   */
  async estimateUserOperationGas(
    userOp: Partial<PimlicoUserOperation>,
    entryPoint: `0x${string}` = ENTRY_POINT_V07,
  ): Promise<PimlicoGasEstimate> {
    return this.bundlerRpc<PimlicoGasEstimate>('eth_estimateUserOperationGas', [
      this.sanitizeUserOp(userOp),
      entryPoint,
    ]);
  }

  /**
   * Send a UserOperation to the bundler.
   * Returns the userOpHash.
   */
  async sendUserOperation(
    userOp: PimlicoUserOperation,
    entryPoint: `0x${string}` = ENTRY_POINT_V07,
  ): Promise<`0x${string}`> {
    return this.bundlerRpc<`0x${string}`>('eth_sendUserOperation', [
      userOp,
      entryPoint,
    ]);
  }

  /**
   * Get the receipt of a UserOperation.
   * Returns null if not yet included.
   */
  async getUserOperationReceipt(
    userOpHash: `0x${string}`,
  ): Promise<PimlicoUserOperationReceipt | null> {
    try {
      return await this.bundlerRpc<PimlicoUserOperationReceipt>(
        'eth_getUserOperationReceipt',
        [userOpHash],
      );
    } catch (err) {
      // Bundler returns error when not found — treat as null
      return null;
    }
  }

  /**
   * Get supported entry points.
   */
  async getSupportedEntryPoints(): Promise<`0x${string}`[]> {
    const result = await this.bundlerRpc<{ entryPoints: `0x${string}`[] }>(
      'eth_supportedEntryPoints',
      [],
    );
    return result.entryPoints;
  }

  // -----------------------------------------------------------------------
  // High-level helpers
  // -----------------------------------------------------------------------

  /**
   * Phase 1: Estimate gas + get paymaster data — no signature needed.
   * Returns estimates and paymaster sponsorship for the FE to sign.
   */
  async deployAndExecute(params: {
    sender: `0x${string}`;
    initCode: `0x${string}`;
    callData: `0x${string}`;
    entryPoint?: `0x${string}`;
  }): Promise<{
    nonce: string;
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
    paymaster: `0x${string}` | null;
    paymasterData: `0x${string}` | null;
    paymasterVerificationGasLimit: string;
    paymasterPostOpGasLimit: string;
  }> {
    const entryPoint = params.entryPoint ?? ENTRY_POINT_V07;

    // Split initCode into factory (20 bytes) + factoryData (rest) for v0.7
    const factory = params.initCode.slice(0, 42) as `0x${string}`;
    const factoryData = ('0x' + params.initCode.slice(42)) as `0x${string}`;
    const baseUserOp: Partial<PimlicoUserOperation> = {
      sender: params.sender,
      factory,
      factoryData,
      callData: params.callData,
      nonce: '0x0',
      maxFeePerGas: '0x0',
      maxPriorityFeePerGas: '0x0',
      signature: '0x' as `0x${string}`,
    };

    // Get paymaster stub data
    let paymasterStub: PimlicoPaymasterStubData;
    try {
      paymasterStub = await this.getPaymasterStubData(baseUserOp, entryPoint, this.sponsorshipPolicy);
    } catch (err) {
      this.logger.warn(`Paymaster stub failed: ${(err as Error).message}`);
      paymasterStub = { paymaster: null as any, paymasterData: null as any, paymasterVerificationGasLimit: '0x0', paymasterPostOpGasLimit: '0x0' };
    }

    const gasEstimate = await this.estimateUserOperationGas(baseUserOp, entryPoint);

    const pmUserOp: Partial<PimlicoUserOperation> = {
      ...baseUserOp,
      paymaster: paymasterStub.paymaster,
      paymasterData: paymasterStub.paymasterData,
      paymasterVerificationGasLimit: paymasterStub.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: paymasterStub.paymasterPostOpGasLimit,
      callGasLimit: gasEstimate.callGasLimit,
      verificationGasLimit: gasEstimate.verificationGasLimit,
      preVerificationGas: gasEstimate.preVerificationGas,
    };

    let paymasterData: PimlicoPaymasterData;
    try {
      paymasterData = await this.getPaymasterData(pmUserOp, entryPoint, this.sponsorshipPolicy);
    } catch (err) {
      this.logger.warn(`Paymaster data failed: ${(err as Error).message}`);
      paymasterData = { paymaster: null as any, paymasterData: null as any, paymasterVerificationGasLimit: '0x0', paymasterPostOpGasLimit: '0x0' };
    }

    return {
      nonce: '0x0',
      callGasLimit: gasEstimate.callGasLimit,
      verificationGasLimit: gasEstimate.verificationGasLimit,
      preVerificationGas: gasEstimate.preVerificationGas,
      paymaster: paymasterData.paymaster,
      paymasterData: paymasterData.paymasterData,
      paymasterVerificationGasLimit: paymasterData.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: paymasterData.paymasterPostOpGasLimit,
    };
  }

  /**
   * Phase 2: Submit a pre-signed UserOp to the bundler.
   * Called after FE signs the UserOp via smart-accounts-kit.
   */
  async submitUserOp(
    userOp: PimlicoUserOperation,
    entryPoint: `0x${string}` = ENTRY_POINT_V07,
  ): Promise<`0x${string}`> {
    return this.sendUserOperation(userOp, entryPoint);
  }

  /**
   * Poll for a UserOperation receipt.
   * Resolves when the receipt is available or timeout is reached.
   */
  async pollForReceipt(
    userOpHash: `0x${string}`,
    timeoutMs = 120_000,
    intervalMs = 3_000,
  ): Promise<PimlicoUserOperationReceipt> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const receipt = await this.getUserOperationReceipt(userOpHash);
      if (receipt) {
        this.logger.log(`UserOperation confirmed hash=${receipt.receipt.transactionHash}`);
        return receipt;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(`UserOperation ${userOpHash} timed out after ${timeoutMs}ms`);
  }

  // -----------------------------------------------------------------------
  // Private — RPC calls
  // -----------------------------------------------------------------------

  private async paymasterRpc<T>(method: string, params: unknown[]): Promise<T> {
    return this.rpc<T>(this.paymasterUrl, method, params);
  }

  private async bundlerRpc<T>(method: string, params: unknown[]): Promise<T> {
    return this.rpc<T>(this.bundlerUrl, method, params);
  }

  private async rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
    const body = { jsonrpc: '2.0' as const, id: 1, method, params };

    this.logger.debug(`Pimlico RPC ${method}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string; data?: unknown };
    };

    if (!res.ok || json.error) {
      const msg = JSON.stringify(json.error ?? json);
      this.logger.error(`Pimlico RPC error ${method}: ${msg}`);
      throw new Error(`Pimlico error: ${msg}`);
    }

    if (json.result === undefined) {
      throw new Error(`Pimlico missing result for ${method}: ${JSON.stringify(json)}`);
    }

    return json.result;
  }

  /**
   * Sanitize a partial userOp for RPC serialization.
   * Removes undefined fields and ensures hex values are properly formatted.
   */
  private sanitizeUserOp(
    userOp: Partial<PimlicoUserOperation>,
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(userOp)) {
      if (value !== undefined) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
