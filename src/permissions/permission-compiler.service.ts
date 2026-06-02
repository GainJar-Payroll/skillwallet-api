import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { sha256Hex } from '../common/utils/hash';
import { frequencyToPeriodSeconds, unixSeconds, addDays } from '../common/utils/time';
import { Address, HexString } from '../common/types/evm';

export interface DcaCompileInput {
  skillId: string;
  chainId: number;
  userAddress: Address;
  smartAccountAddress: Address;
  executorAddress: Address;
  config: {
    type: 'dca';
    tokenIn: { symbol: string; address: Address; decimals: number };
    tokenOut: { symbol: string; address: Address; decimals: number };
    amountPerRun: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    maxSlippageBps: number;
    router: { name: string; address: Address };
    recipient: Address;
    quoteMode: string;
    minAmountOut?: string;
  };
  durationDays: number;
  now?: Date;
}

export interface AerodromeVoteCompileInput {
  skillId: string;
  chainId: number;
  userAddress: Address;
  smartAccountAddress: Address;
  executorAddress: Address;
  config: {
    type: 'aerodrome-vote';
    veAeroTokenId: string;
    strategy: string;
    maxPools: number;
    executionWindow?: { day: string; startUtcHour: number; endUtcHour: number };
    allowAiExplanation: boolean;
  };
  durationDays: number;
  now?: Date;
}

export interface CompiledPermission {
  manifest: Record<string, unknown>;
  manifestHash: string;
  walletRequest: Record<string, unknown>;
  requestId: string;
  requestHash: string;
}

@Injectable()
export class PermissionCompilerService {
  compileDca(input: DcaCompileInput): CompiledPermission {
    const now = input.now ?? new Date();
    const validUntil = addDays(now, input.durationDays);
    const periodSeconds = frequencyToPeriodSeconds(input.config.frequency);

    const rules = [
      {
        id: 'rule.erc20-periodic-spend',
        label: 'ERC-20 periodic spend cap',
        description: `Allow spending up to ${input.config.amountPerRun} USDC every ${input.config.frequency} period.`,
        enforcement: 'wallet-permission',
        source: 'erc7715',
        kind: 'erc20-periodic-spend',
        data: {
          tokenAddress: input.config.tokenIn.address,
          periodAmount: input.config.amountPerRun,
          periodDuration: periodSeconds,
          frequency: input.config.frequency,
        },
      },
      {
        id: 'rule.expiry',
        label: 'Permission expiry',
        description: `Permission expires at ${validUntil.toISOString()}.`,
        enforcement: 'wallet-permission',
        source: 'erc7715',
        kind: 'expiry',
        data: { validUntil: validUntil.toISOString() },
      },
      {
        id: 'rule.allowed-target',
        label: 'Allowed target (router)',
        description: `Only the configured router ${input.config.router.address} is allowed as a target.`,
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'allowed-target',
        data: { target: input.config.router.address },
      },
      {
        id: 'rule.fixed-token-in',
        label: 'Fixed token-in (USDC)',
        description: 'Only USDC may be the input token.',
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'fixed-token-in',
        data: { token: input.config.tokenIn.address },
      },
      {
        id: 'rule.fixed-token-out',
        label: 'Fixed token-out (WETH)',
        description: 'Only WETH may be the output token.',
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'fixed-token-out',
        data: { token: input.config.tokenOut.address },
      },
      {
        id: 'rule.fixed-recipient',
        label: 'Fixed recipient (smart account)',
        description: `Output must be delivered back to the smart account ${input.smartAccountAddress}.`,
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'fixed-recipient',
        data: { recipient: input.smartAccountAddress },
      },
      {
        id: 'rule.max-slippage',
        label: 'Max slippage',
        description: `Maximum slippage is ${input.config.maxSlippageBps} bps.`,
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'max-slippage',
        data: { maxSlippageBps: input.config.maxSlippageBps },
      },
      {
        id: 'rule.no-unlimited-approval',
        label: 'No unlimited approval',
        description: 'Token approvals must be exactly the period amount.',
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'no-unlimited-approval',
        data: { maxAllowance: input.config.amountPerRun },
      },
    ];

    const allowedActions = [
      'Spend configured USDC amount for DCA',
      'Swap USDC to WETH using configured router',
      'Send output back to the Smart Account',
    ];

    const forbiddenActions = [
      'Transfer funds to arbitrary addresses',
      'Approve unlimited token allowance',
      'Use unknown routers',
      'Swap into unknown tokens',
      'Withdraw funds to executor',
    ];

    const manifestBase = {
      version: 'skillwallet.permission.v1',
      skillId: input.skillId,
      chainId: input.chainId,
      delegator: input.userAddress,
      delegate: input.executorAddress,
      title: `DCA USDC → WETH for ${input.skillId}`,
      summary: `Permission to swap up to ${input.config.amountPerRun} USDC for WETH via router ${input.config.router.address} every ${input.config.frequency} period, returning WETH to ${input.smartAccountAddress}.`,
      allowedActions,
      forbiddenActions,
      allowedTargets: [input.config.router.address],
      allowedSelectors: [],
      allowedTokens: [input.config.tokenIn.address, input.config.tokenOut.address],
      rules,
      validAfter: now,
      validUntil,
    };

    const manifestHash = sha256Hex(manifestBase);
    const manifestId = `manifest_${uuidv4()}`;
    const manifest = { ...manifestBase, manifestId };

    const amountPerRunBaseUnits = this.toBaseUnits(
      input.config.amountPerRun,
      input.config.tokenIn.decimals,
    );
    const requestId = `req_${uuidv4()}`;
    const chainIdHex = this.toChainIdHex(input.chainId);
    const expiry = unixSeconds(validUntil);
    const startTime = unixSeconds(now);

    const rawRequest = {
      chainId: chainIdHex,
      from: input.smartAccountAddress,
      to: input.executorAddress,
      expiry,
      permission: {
        type: 'erc20-token-periodic',
        isAdjustmentAllowed: false,
        data: {
          tokenAddress: input.config.tokenIn.address,
          periodAmount: amountPerRunBaseUnits,
          periodDuration: periodSeconds,
          startTime,
          justification: `SkillWallet DCA: spend up to ${input.config.amountPerRun} USDC per period for scheduled USDC to WETH DCA.`,
        },
      },
    };

    const normalized = {
      chainId: input.chainId,
      from: input.smartAccountAddress,
      to: input.executorAddress,
      expiry,
      permissions: [
        {
          type: 'erc20-token-periodic',
          isAdjustmentAllowed: false,
          data: rawRequest.permission.data,
        },
      ],
      rules: [
        {
          type: 'erc20-periodic-spend',
          data: rules[0]?.data,
        },
      ],
    };

    const walletRequest = {
      standard: 'erc7715',
      method: 'wallet_requestExecutionPermissions',
      requestId,
      rawRequest,
      normalized,
    };

    const requestHash = sha256Hex(rawRequest);

    return { manifest, manifestHash, walletRequest, requestId, requestHash };
  }

  compileAerodromeVote(input: AerodromeVoteCompileInput): CompiledPermission {
    const now = input.now ?? new Date();
    const validUntil = addDays(now, input.durationDays);

    const allowedActions = [
      'Cast veAERO votes for the configured strategy',
      'Revote when reward density changes',
    ];

    const forbiddenActions = [
      'Withdraw veAERO principal',
      'Lock additional veAERO',
      'Vote on pools not returned by the strategy',
    ];

    const rules = [
      {
        id: 'rule.expiry',
        label: 'Permission expiry',
        description: `Permission expires at ${validUntil.toISOString()}.`,
        enforcement: 'wallet-permission',
        source: 'erc7715',
        kind: 'expiry',
        data: { validUntil: validUntil.toISOString() },
      },
      {
        id: 'rule.aerodrome-vote-strategy',
        label: 'Vote strategy',
        description: `Vote strategy: ${input.config.strategy}, max pools: ${input.config.maxPools}.`,
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'custom',
        data: { strategy: input.config.strategy, maxPools: input.config.maxPools },
      },
    ];

    const manifestBase = {
      version: 'skillwallet.permission.v1',
      skillId: input.skillId,
      chainId: input.chainId,
      delegator: input.userAddress,
      delegate: input.executorAddress,
      title: `Aerodrome Vote Optimizer for ${input.skillId}`,
      summary: `Permission to cast veAERO votes according to ${input.config.strategy} strategy (max ${input.config.maxPools} pools).`,
      allowedActions,
      forbiddenActions,
      allowedTargets: [],
      allowedSelectors: [],
      allowedTokens: [],
      rules,
      validAfter: now,
      validUntil,
    };

    const manifestHash = sha256Hex(manifestBase);
    const manifestId = `manifest_${uuidv4()}`;
    const manifest = { ...manifestBase, manifestId };

    const requestId = `req_${uuidv4()}`;
    const chainIdHex = this.toChainIdHex(input.chainId);
    const expiry = unixSeconds(validUntil);

    const rawRequest = {
      chainId: chainIdHex,
      from: input.smartAccountAddress,
      to: input.executorAddress,
      expiry,
      permission: {
        type: 'aerodrome-vote-optimizer',
        isAdjustmentAllowed: false,
        data: {
          veAeroTokenId: input.config.veAeroTokenId,
          strategy: input.config.strategy,
          maxPools: input.config.maxPools,
          executionWindow: input.config.executionWindow,
        },
      },
    };

    const normalized = {
      chainId: input.chainId,
      from: input.smartAccountAddress,
      to: input.executorAddress,
      expiry,
      permissions: [
        {
          type: 'aerodrome-vote-optimizer',
          isAdjustmentAllowed: false,
          data: rawRequest.permission.data,
        },
      ],
    };

    const walletRequest = {
      standard: 'erc7715',
      method: 'wallet_requestExecutionPermissions',
      requestId,
      rawRequest,
      normalized,
    };

    const requestHash = sha256Hex(rawRequest);

    return { manifest, manifestHash, walletRequest, requestId, requestHash };
  }

  private toBaseUnits(amount: string, decimals: number): string {
    const [whole, fraction = ''] = amount.split('.');
    const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
    return `${whole}${padded}`.replace(/^0+/, '') || '0';
  }

  private toChainIdHex(chainId: number): HexString {
    return `0x${chainId.toString(16)}` as HexString;
  }
}
