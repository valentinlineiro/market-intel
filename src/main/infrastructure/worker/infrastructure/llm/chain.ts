import type { ILLMProvider } from '../../application/ports.js';
import type { Config } from '../../domain/types.js';

const PROVIDERS = {
  groq:       { url: 'https://api.groq.com/openai/v1/chat/completions' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions' },
  nim:        { url: 'https://integrate.api.nvidia.com/v1/chat/completions' },
  mistral:    { url: 'https://api.mistral.ai/v1/chat/completions' },
} as const;

type ProviderKey = keyof typeof PROVIDERS;

export class LLMChain implements ILLMProvider {
  private readonly keys: Record<ProviderKey, string | undefined>;

  constructor(
    private readonly cfg: Config['llm'],
    groqApiKey: string | undefined,
    openrouterApiKey: string | undefined,
    nimApiKey: string | undefined,
    mistralApiKey: string | undefined,
  ) {
    this.keys = { groq: groqApiKey, openrouter: openrouterApiKey, nim: nimApiKey, mistral: mistralApiKey };
  }

  async complete(prompt: string, maxTokens: number): Promise<string> {
    const preferred = this.cfg.provider as ProviderKey | undefined;

    // If a specific provider is configured and its key is available, use it directly
    if (preferred && preferred in PROVIDERS && this.keys[preferred]) {
      return this._call(PROVIDERS[preferred].url, this.keys[preferred]!, this.cfg.model, prompt, maxTokens);
    }

    // Legacy fallback: groq → openrouter
    if (this.keys.groq) {
      try {
        return await this._call(PROVIDERS.groq.url, this.keys.groq, this.cfg.model, prompt, maxTokens);
      } catch (e) {
        console.error('groq failed, falling back:', e instanceof Error ? e.message : String(e));
      }
    }
    if (this.keys.openrouter) {
      return this._call(PROVIDERS.openrouter.url, this.keys.openrouter, this.cfg.model, prompt, maxTokens);
    }

    throw new Error('No LLM key available (set GROQ_API_KEY, OPENROUTER_API_KEY, NIM_API_KEY, or MISTRAL_API_KEY)');
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
