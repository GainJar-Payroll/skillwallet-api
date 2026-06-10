import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { http, createPublicClient, type Hex, toHex } from 'viem';
import { baseSepolia } from 'viem/chains';

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
  private bundlerClient: ReturnType<typeof createBundlerClient>;
  private paymasterClient: ReturnType<typeof createPaymasterClient>;

  constructor(private readonly config: ConfigService) {
    this.paymasterUrl = this.config.get<string>('pimlico.paymasterUrl')!;
    this.bundlerUrl = this.config.get<string>('pimlico.bundlerUrl')!;
    this.sponsorshipPolicy = this.config.get<string>('pimlico.sponsorshipPolicy') ?? '';

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http('https://sepolia.base.org'),
    });

    this.bundlerClient = createBundlerClient({
      client: publicClient,
      transport: http(this.bundlerUrl),
    });

    this.paymasterClient = createPaymasterClient({
      transport: http(this.paymasterUrl || this.bundlerUrl),
    });
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
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    paymaster: `0x${string}` | null;
    paymasterData: `0x${string}` | null;
    paymasterVerificationGasLimit: string;
    paymasterPostOpGasLimit: string;
  }> {
    const entryPoint = params.entryPoint ?? ENTRY_POINT_V07;
    const chainId = 84532; // baseSepolia

    // Split initCode into factory (20 bytes) + factoryData (rest) for v0.7
    const factory = params.initCode.slice(0, 42) as `0x${string}`;
    const factoryData = ('0x' + params.initCode.slice(42)) as `0x${string}`;

    // Default dummy values for estimation phase
    const defaultUserOp = {
      sender: params.sender,
      nonce: 0n,
      factory,
      factoryData,
      callData: params.callData,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      signature: '0x' as Hex,
      preVerificationGas: 21000n,
      verificationGasLimit: 100000n,
      callGasLimit: 100000n,
    };

    // Get paymaster stub data
    let paymasterStub: {
      paymaster: `0x${string}`;
      paymasterData: `0x${string}`;
      paymasterVerificationGasLimit: bigint;
      paymasterPostOpGasLimit: bigint;
    };
    try {
      const result = await this.paymasterClient.getPaymasterStubData({
        sender: params.sender,
        nonce: 0n,
        factory,
        factoryData,
        callData: params.callData,
        callGasLimit: 100000n,
        entryPointAddress: entryPoint,
        chainId,
        context: { sponsorshipPolicyId: this.sponsorshipPolicy },
      });
      // Handle v0.6 vs v0.7+ return format
      if ('paymasterAndData' in result) {
        paymasterStub = {
          paymaster: result.paymasterAndData as `0x${string}`,
          paymasterData: '0x' as `0x${string}`,
          paymasterVerificationGasLimit: 0n,
          paymasterPostOpGasLimit: 0n,
        };
      } else {
        paymasterStub = {
          paymaster: result.paymaster,
          paymasterData: result.paymasterData,
          paymasterVerificationGasLimit: result.paymasterVerificationGasLimit ?? 0n,
          paymasterPostOpGasLimit: result.paymasterPostOpGasLimit,
        };
      }
    } catch (err) {
      this.logger.warn(`Paymaster stub failed: ${(err as Error).message}`);
      paymasterStub = {
        paymaster: '0x' as `0x${string}`,
        paymasterData: '0x' as `0x${string}`,
        paymasterVerificationGasLimit: 0n,
        paymasterPostOpGasLimit: 0n,
      };
    }

    // Build userOp with paymaster stub for gas estimation
    const userOpForEstimate = {
      ...defaultUserOp,
      paymaster: paymasterStub.paymaster as `0x${string}`,
      paymasterData: paymasterStub.paymasterData as `0x${string}`,
      paymasterVerificationGasLimit: paymasterStub.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: paymasterStub.paymasterPostOpGasLimit,
    };

    // Estimate gas
    type GasEstimate = { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint };
    let gasEstimate: GasEstimate;
    try {
      gasEstimate = await this.bundlerClient.estimateUserOperationGas({
        ...userOpForEstimate,
        entryPointAddress: entryPoint,
      }) as GasEstimate;
    } catch (err) {
      this.logger.warn(`Gas estimation failed: ${(err as Error).message}`);
      gasEstimate = {
        callGasLimit: 100000n,
        verificationGasLimit: 100000n,
        preVerificationGas: 21000n,
      };
    }

    // Get real paymaster data
    let paymasterData: {
      paymaster: `0x${string}`;
      paymasterData: `0x${string}`;
      paymasterVerificationGasLimit: bigint;
      paymasterPostOpGasLimit: bigint;
    };
    try {
      const result = await this.paymasterClient.getPaymasterData({
        sender: params.sender,
        nonce: 0n,
        factory,
        factoryData,
        callData: params.callData,
        callGasLimit: gasEstimate.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit,
        preVerificationGas: gasEstimate.preVerificationGas,
        maxFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
        entryPointAddress: entryPoint,
        chainId,
        context: { sponsorshipPolicyId: this.sponsorshipPolicy },
      });
      // Handle v0.6 vs v0.7+ return format
      if ('paymasterAndData' in result) {
        paymasterData = {
          paymaster: result.paymasterAndData as `0x${string}`,
          paymasterData: '0x' as `0x${string}`,
          paymasterVerificationGasLimit: 0n,
          paymasterPostOpGasLimit: 0n,
        };
      } else {
        paymasterData = {
          paymaster: result.paymaster,
          paymasterData: result.paymasterData,
          paymasterVerificationGasLimit: result.paymasterVerificationGasLimit ?? 0n,
          paymasterPostOpGasLimit: result.paymasterPostOpGasLimit ?? 0n,
        };
      }
    } catch (err) {
      this.logger.warn(`Paymaster data failed: ${(err as Error).message}`);
      paymasterData = {
        paymaster: '0x' as `0x${string}`,
        paymasterData: '0x' as `0x${string}`,
        paymasterVerificationGasLimit: 0n,
        paymasterPostOpGasLimit: 0n,
      };
    }

    return {
      nonce: '0x0',
      callGasLimit: toHex(gasEstimate.callGasLimit),
      verificationGasLimit: toHex(gasEstimate.verificationGasLimit),
      preVerificationGas: toHex(gasEstimate.preVerificationGas),
      paymaster: paymasterData.paymaster || null,
      paymasterData: paymasterData.paymasterData || null,
      paymasterVerificationGasLimit: toHex(paymasterData.paymasterVerificationGasLimit),
      paymasterPostOpGasLimit: toHex(paymasterData.paymasterPostOpGasLimit),
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
