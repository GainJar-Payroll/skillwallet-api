import { encodeFunctionData, type Address, type Hex } from 'viem';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'int256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

const SWAP_ROUTER_02_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

export interface ExactInputSingleParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: 100 | 500 | 3000 | 10000;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
}

export function encodeApprove(params: { token: Address; spender: Address; amount: bigint }): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [params.spender, params.amount],
  });
}

export function encodeTransfer(params: { token: Address; to: Address; amount: bigint }): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [params.to, params.amount],
  });
}

export function encodeExactInputSingle(params: ExactInputSingleParams): Hex {
  return encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        recipient: params.recipient,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
      },
    ],
  });
}

export function encodeQuoteExactInputSingle(params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  fee: 100 | 500 | 3000 | 10000;
}): Hex {
  return encodeFunctionData({
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        fee: params.fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
}
