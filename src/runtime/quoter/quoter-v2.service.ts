import { Injectable, Logger } from '@nestjs/common';
import { findDexRouter } from '../../chains/registry/dex';
import type { Address, HexString } from '../../common/types/evm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { encodeQuoteExactInputSingle } from '../adapters/dex/uniswap-v3.builder';

interface RpcResponse {
  result?: HexString;
  error?: { code: number; message: string; data?: unknown };
}

function rpcUrl(chainId: number): string {
  if (chainId === 84532) return 'https://sepolia.base.org';
  if (chainId === 8453) return 'https://mainnet.base.org';
  return 'https://rpc.sepolia.org';
}

@Injectable()
export class QuoterV2Service {
  private readonly logger = new Logger(QuoterV2Service.name);

  async quoteExactInputSingle(params: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    fee: 100 | 500 | 3000 | 10000;
  }): Promise<bigint> {
    const router = findDexRouter(params.chainId, 'uniswap-v3');
    if (!router?.quoterV2) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        500,
        `QuoterV2 not configured for chainId ${params.chainId}`,
      );
    }

    const data = encodeQuoteExactInputSingle(params);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_call',
      params: [{ to: router.quoterV2, data }, 'latest'],
    });

    let response: Response;
    try {
      response = await fetch(rpcUrl(params.chainId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`QuoterV2 transport failed for chainId=${params.chainId}: ${message}`);
      throw new AppError(ErrorCode.RELAYER_TRANSPORT_ERROR, 502, `QuoterV2 RPC failed: ${message}`);
    }

    const parsed = (await response.json()) as RpcResponse;
    if (!response.ok || parsed.error || !parsed.result) {
      const message = parsed.error?.message ?? `HTTP ${response.status}`;
      this.logger.error(`QuoterV2 quote failed for chainId=${params.chainId}: ${message}`);
      throw new AppError(ErrorCode.RELAYER_RPC_ERROR, 502, `QuoterV2 quote failed: ${message}`);
    }

    // ABI output first word = amountOut uint256. Other return values are ignored.
    return BigInt(`0x${parsed.result.slice(2, 66)}`);
  }
}
