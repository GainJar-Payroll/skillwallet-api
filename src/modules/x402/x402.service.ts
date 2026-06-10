import { Injectable, Logger } from '@nestjs/common';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { ExecutorService } from '../executor/executor.service';

@Injectable()
export class X402Service {
  private readonly logger = new Logger(X402Service.name);
  private httpClient: x402HTTPClient | null = null;

  constructor(private readonly executorService: ExecutorService) {}

  private getHttpClient(): x402HTTPClient {
    if (!this.httpClient) {
      const signer = this.executorService.getAccount();
      const coreClient = new x402Client().register(
        'eip155:*',
        new ExactEvmScheme(signer),
      );
      this.httpClient = new x402HTTPClient(coreClient);
    }
    return this.httpClient;
  }

  async fetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res1 = await fetch(url, options);
    if (res1.ok) {
      return (await res1.json()) as T;
    }

    if (res1.status !== 402) {
      throw new Error(`x402 unexpected status ${res1.status} from ${url}`);
    }

    const paymentRequired = this.getHttpClient().getPaymentRequiredResponse(
      (name) => res1.headers.get(name),
      await res1.json(),
    );

    const paymentPayload = await this.getHttpClient().createPaymentPayload(
      paymentRequired,
    );

    const paymentHeaders = this.getHttpClient().encodePaymentSignatureHeader(
      paymentPayload,
    );

    const res2 = await fetch(url, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        ...paymentHeaders,
      },
    });

    if (!res2.ok) {
      const body = await res2.text().catch(() => '');
      const settle = this.getHttpClient().getPaymentSettleResponse(
        (name) => res2.headers.get(name),
      );
      this.logger.error(
        `x402 payment failed: ${res2.status} body=${body} settle=${JSON.stringify(settle)}`,
      );
      throw new Error(`x402: payment failed with status ${res2.status}`);
    }

    // Process payment result (triggers hooks, checks settlement)
    const result = await this.getHttpClient().processResponse(res2);
    if (result.kind === 'settle_failed') {
      this.logger.warn('x402 payment succeeded but settlement had issues');
      return result.body as T;
    }
    if (result.kind === 'error') {
      throw new Error(`x402: unexpected error after payment`);
    }
    if (result.kind === 'success' || result.kind === 'passthrough') {
      return result.body as T;
    }

    throw new Error('x402: server still requires payment after sending header');
  }
}
