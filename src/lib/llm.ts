import OpenAI from "openai";

/**
 * Returns an OpenAI-compatible client and model name.
 * Uses Groq (free tier) if GROQ_API_KEY is set, otherwise OpenAI.
 */
export function getLLM(): { client: OpenAI; model: string } {
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    return {
      client: new OpenAI({
        apiKey: groqKey,
        baseURL: "https://api.groq.com/openai/v1",
      }),
      model: "llama-3.1-70b-versatile",
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      client: new OpenAI({ apiKey: openaiKey }),
      model: "gpt-4o-mini",
    };
  }
  throw new Error(
    "No API key set. Add GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY in Vercel Environment Variables, then redeploy."
  );
}

export function hasLLMKey(): boolean {
  return !!(process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}
