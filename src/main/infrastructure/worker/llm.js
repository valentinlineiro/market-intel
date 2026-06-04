import { getConfig } from "./config.js";

const PROVIDERS = {
  groq:       { url: "https://api.groq.com/openai/v1/chat/completions" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions" },
};

export async function callLLM(prompt, env, { maxTokens = 800 } = {}) {
  const cfg = await getConfig(env.DB);
  const llm = cfg.llm;

  const key = (p) => p === "groq" ? env.GROQ_API_KEY : env.OPENROUTER_API_KEY;

  const primary = PROVIDERS[llm.primary_provider];
  if (primary && key(llm.primary_provider)) {
    try {
      return await _call(primary.url, key(llm.primary_provider), llm.primary_model, prompt, maxTokens);
    } catch (e) {
      console.error(`${llm.primary_provider} failed, falling back:`, e.message);
    }
  }

  const fallback = PROVIDERS[llm.fallback_provider];
  if (fallback && key(llm.fallback_provider)) {
    return await _call(fallback.url, key(llm.fallback_provider), llm.fallback_model, prompt, maxTokens);
  }

  throw new Error("No LLM key available (GROQ_API_KEY or OPENROUTER_API_KEY required)");
}

async function _call(url, apiKey, model, prompt, maxTokens) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const choices = data?.choices;
  if (!choices?.length) throw new Error(`Empty choices from ${url}`);
  return choices[0].message.content.trim();
}
