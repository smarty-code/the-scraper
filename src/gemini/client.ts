import { AskResult } from "../chatgpt/conversation";
import { AIProvider } from "../ai/provider";

export class GeminiProvider implements AIProvider {
  private apiKey: string;
  private modelUrl: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || "";
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    this.modelUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }

  public async ask(prompt: string, _deleteConv = true): Promise<AskResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "GEMINI_API_KEY is not defined in the environment variables."
      };
    }

    try {
      console.log(`[Gemini] Submitting request to model URL: ${this.modelUrl}`);
      const response = await fetch(this.modelUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": this.apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Gemini] API returned error status ${response.status}:`, errText);
        return {
          success: false,
          error: `Gemini API returned status ${response.status}: ${errText}`
        };
      }

      const data = (await response.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.error("[Gemini] Invalid or empty response payload:", JSON.stringify(data));
        return {
          success: false,
          rawResponse: JSON.stringify(data),
          error: "Gemini API returned an empty response or invalid payload structure."
        };
      }

      return {
        success: true,
        answer: text,
        rawResponse: JSON.stringify(data),
        method: "network"
      };
    } catch (err: any) {
      console.error("[Gemini] Network or system error during ask:", err);
      return {
        success: false,
        error: err.message || String(err)
      };
    }
  }
}
