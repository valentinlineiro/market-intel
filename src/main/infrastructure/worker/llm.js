// Shared LLM caller — tries Groq first (fast, free tier), falls back to OpenRouter.
export async function callLLM(prompt, env, { maxTokens = 800 } = {}) {
  if (env.GROQ_API_KEY) {
    try {
      return await _call(
        "https://api.groq.com/openai/v1/chat/completions",
        env.GROQ_API_KEY,
        "llama-3.1-8b-instant",
        prompt,
        maxTokens,
      );
    } catch (e) {
      console.error("Groq failed, falling back to OpenRouter:", e.message);
    }
  }

  if (env.OPENROUTER_API_KEY) {
    return await _call(
      "https://openrouter.ai/api/v1/chat/completions",
      env.OPENROUTER_API_KEY,
      "anthropic/claude-haiku-4-5",
      prompt,
      maxTokens,
    );
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
