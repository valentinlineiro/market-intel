import type { ILLMProvider } from '../../application/ports.js';
import type { Config } from '../../domain/types.js';

const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions' },
} as const;

export class LLMChain implements ILLMProvider {
  constructor(
    private readonly cfg: Config['llm'],
    private readonly groqApiKey: string | undefined,
    private readonly openrouterApiKey: string | undefined,
  ) {}

  async complete(prompt: string, maxTokens: number): Promise<string> {
    // Try Groq first
    if (this.groqApiKey) {
      try {
        return await this._call(PROVIDERS.groq.url, this.groqApiKey, this.cfg.model, prompt, maxTokens);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('groq failed, falling back:', message);
      }
    }

    // Fall back to OpenRouter
    if (this.openrouterApiKey) {
      return await this._call(PROVIDERS.openrouter.url, this.openrouterApiKey, this.cfg.model, prompt, maxTokens);
    }

    throw new Error('No LLM key available (GROQ_API_KEY or OPENROUTER_API_KEY required)');
  }

  private async _call(
    url: string,
    apiKey: string,
    model: string,
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message: { content: string } }> };
    const choices = data?.choices;
    if (!choices?.length) throw new Error(`Empty choices from ${url}`);
    return choices[0].message.content.trim();
  }
}
