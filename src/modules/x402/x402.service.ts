import { Injectable, Logger } from '@nestjs/common';
import { createPaymentHeader } from 'x402/client';
import { ExecutorService } from '../executor/executor.service';

interface PaymentRequirements {
  network?: string;
  payTo?: string;
  asset?: string;
  scheme?: string;
  maxAmountRequired?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

@Injectable()
export class X402Service {
  private readonly logger = new Logger(X402Service.name);

  constructor(private readonly executorService: ExecutorService) {}

  async fetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res1 = await fetch(url, options);
    if (res1.ok) {
      return (await res1.json()) as T;
    }

    if (res1.status !== 402) {
      throw new Error(`x402 unexpected status ${res1.status} from ${url}`);
    }

    const paymentRequiredHeader = res1.headers.get('PAYMENT-REQUIRED');
    if (!paymentRequiredHeader) {
      throw new Error('x402: missing PAYMENT-REQUIRED header');
    }

    const paymentRequired = JSON.parse(paymentRequiredHeader) as {
      accepts?: PaymentRequirements[];
      [key: string]: unknown;
    };
    const baseAccept = paymentRequired.accepts?.find((a) => a.network === 'base');
    if (!baseAccept) {
      throw new Error('x402: no Base network payment option found');
    }

    const signer = this.executorService.getAccount();
    const paymentHeader = await createPaymentHeader(signer, 2, baseAccept as never);

    const res2 = await fetch(url, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        'X-402-Payment': paymentHeader,
      },
    });
    if (!res2.ok) {
      const body = await res2.text().catch(() => '');
      this.logger.error(`x402 payment failed: ${res2.status} ${body}`);
      throw new Error(`x402: payment failed with status ${res2.status}`);
    }
    return (await res2.json()) as T;
  }
}
