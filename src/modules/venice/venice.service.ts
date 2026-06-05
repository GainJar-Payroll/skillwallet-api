import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VeniceClient } from 'venice-x402-client';

export interface VeniceMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class VeniceService implements OnModuleInit {
  private readonly logger = new Logger(VeniceService.name);
  private client!: VeniceClient;
  private readonly apiBase!: string;
  private readonly model!: string;

  constructor(private readonly config: ConfigService) {
    this.apiBase = this.config.get<string>('venice.apiBase')!;
    this.model = this.config.get<string>('venice.model')!;
  }

  onModuleInit(): void {
    const pk = this.config.get<`0x${string}`>('executorPrivateKey')!;
    const topUp = this.config.get<number>('venice.topUpAmountUsd') ?? 5;
    this.client = new VeniceClient(pk, {
      apiUrl: this.apiBase,
      autoTopUp: {
        enabled: true,
        amount: topUp,
      },
    });
    this.logger.log(`Venice client initialised (model=${this.model})`);
  }

  async chat(messages: VeniceMessage[]): Promise<string> {
    const response = await this.client.chat({
      model: this.model,
      messages,
      max_tokens: 300,
    });
    return response.choices?.[0]?.message?.content ?? '';
  }

  async summariseMarketContext(newsText: string): Promise<string> {
    return this.chat([
      {
        role: 'system',
        content:
          'You are a concise crypto market analyst. Summarise the following news in 2-3 sentences. Focus on actionable signals for a DCA (Dollar Cost Averaging) strategy. Be brief.',
      },
      { role: 'user', content: newsText },
    ]);
  }
}
