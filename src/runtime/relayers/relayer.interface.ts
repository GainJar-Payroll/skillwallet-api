export interface RelayInput {
  chainId: number;
  delegationManager?: string;
  permissionContext?: string;
  calls: Array<{
    to: string;
    data: string;
    value?: string;
  }>;
}

export interface RelaySubmissionResult {
  relayId?: string;
  status: 'queued' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  externalStatusUrl?: string;
}

export interface RelayerStatusResult {
  relayId: string;
  status: 'queued' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  error?: string;
}

export interface RelayerInterface {
  relayDelegatedExecution(input: RelayInput): Promise<RelaySubmissionResult>;
  getRelayStatus(relayId: string): Promise<RelayerStatusResult>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}