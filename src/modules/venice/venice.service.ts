import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VeniceMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface DecideResponse {
  decision: 'execute' | 'skip';
  reason: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

@Injectable()
export class VeniceService {
  private readonly logger = new Logger(VeniceService.name);
  private readonly apiBase: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiBase = this.config.get<string>('venice.apiBase')!;
    this.model = this.config.get<string>('venice.model')!;
    this.apiKey = this.config.get<string>('venice.apiKey')!;
  }

  async chat(messages: VeniceMessage[], maxTokens?: number): Promise<string> {
    const url = `${this.apiBase}/chat/completions`;

    this.logger.debug(`Venice chat ${url} model=${this.model}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens ?? 300,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Venice API error ${res.status}: ${text}`);
      throw new Error(`Venice API error: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return json.choices?.[0]?.message?.content ?? '';
  }

  /**
   * Send a full-context prompt to Venice AI and parse the structured JSON response.
   * The prompt should include skill parameters, market data, execution history,
   * and ask for an execute/skip decision.
   */
  async decide(prompt: string): Promise<DecideResponse> {
    const content = await this.chat(
      [
        {
          role: 'system',
          content:
            'You are a crypto market analyst managing a DCA strategy. Analyze the context and decide whether to execute or skip this DCA run. Consider market sentiment, news, and DCA principles. Respond ONLY with valid JSON in this format: {"decision":"execute"|"skip","reason":"brief explanation","sentiment":"bullish"|"bearish"|"neutral"}. No markdown, no code blocks, no extra text.',
        },
        { role: 'user', content: prompt },
      ],
      500,
    );

    // Handle cases where Venice wraps in ```json ... ``` or adds extra text
    const jsonStr = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    try {
      const parsed = JSON.parse(jsonStr) as DecideResponse;

      if (!parsed.decision || !['execute', 'skip'].includes(parsed.decision)) {
        throw new Error(`Invalid decision: ${parsed.decision}`);
      }

      return {
        decision: parsed.decision,
        reason: parsed.reason ?? 'No reason provided',
        sentiment: parsed.sentiment ?? 'neutral',
      };
    } catch (parseErr) {
      this.logger.warn(
        `Failed to parse Venice JSON response, defaulting to execute. Raw: ${content.substring(0, 200)}`,
      );
      // Default to execute on parse failure (fail-open behavior)
      return {
        decision: 'execute',
        reason: 'AI response parse failed — defaulting to execute',
        sentiment: 'neutral',
      };
    }
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
