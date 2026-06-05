import { describe, it, expect } from 'bun:test';
import {
  encodeTransfer,
  encodeApprove,
  encodeExactInputSingle,
} from '../src/runtime/adapters/dex/uniswap-v3.builder';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;
const WETH = '0x4200000000000000000000000000000000000006' as `0x${string}`;
const SWAP = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as `0x${string}`;
const FEE_COLLECTOR = ('0x' + 'aa'.repeat(20)) as `0x${string}`;
const RECIPIENT = ('0x' + 'bb'.repeat(20)) as `0x${string}`;

describe('uniswap-v3 builder', () => {
  describe('encodeTransfer', () => {
    it('selector is 0xa9059cbb (transfer(address,uint256))', () => {
      const calldata = encodeTransfer({ token: USDC, to: FEE_COLLECTOR, amount: 10000n });
      expect(calldata.slice(0, 10)).toBe('0xa9059cbb');
    });

    it('returns 0x + 8 selector + 64 padded to + 64 amount = 138 chars', () => {
      const calldata = encodeTransfer({ token: USDC, to: FEE_COLLECTOR, amount: 10000n });
      expect(calldata.length).toBe(2 + 8 + 64 + 64);
    });
  });

  describe('encodeApprove', () => {
    it('selector is 0x095ea7b3 (approve(address,uint256))', () => {
      const calldata = encodeApprove({ token: USDC, spender: SWAP, amount: 1000000n });
      expect(calldata.slice(0, 10)).toBe('0x095ea7b3');
    });

    it('returns 0x + 8 + 64 spender + 64 amount = 138 chars', () => {
      const calldata = encodeApprove({ token: USDC, spender: SWAP, amount: 1000000n });
      expect(calldata.length).toBe(2 + 8 + 64 + 64);
    });
  });

  describe('encodeExactInputSingle', () => {
    it('selector is 0x04e45aaf (actual computed selector for the struct tuple)', () => {
      const calldata = encodeExactInputSingle({
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 3000,
        recipient: RECIPIENT,
        amountIn: 1000000n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });
      expect(calldata.slice(0, 10)).toBe('0x04e45aaf');
    });

    it('encodes 7 fields × 32 bytes = 224 bytes of params after the selector', () => {
      const calldata = encodeExactInputSingle({
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 3000,
        recipient: RECIPIENT,
        amountIn: 1000000n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });
      expect(calldata.length).toBe(2 + 8 + 7 * 64);
    });
  });
});
