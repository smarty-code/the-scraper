import { AskResult } from "../chatgpt/conversation";
import { BrowserManager } from "../browser/browser";

export interface AIProvider {
  ask(prompt: string, deleteConv?: boolean): Promise<AskResult>;
}

let activeProvider: AIProvider | null = null;

/**
 * Resolves and returns the configured AI provider instance (Gemini or ChatGPT).
 */
export async function getAIProvider(): Promise<AIProvider> {
  if (activeProvider) return activeProvider;

  const providerType = (process.env.AI_PROVIDER || "chatgpt").toLowerCase();
  console.log(`[AI] Initializing provider: "${providerType}"`);

  if (providerType === "gemini") {
    const { GeminiProvider } = await import("../gemini/client");
    activeProvider = new GeminiProvider();
  } else if (providerType === "bedrock") {
    const { BedrockProvider } = await import("../bedrock/client");
    activeProvider = new BedrockProvider();
  } else {
    // Default to ChatGPT via Playwright browser
    const { ConversationManager } = await import("../chatgpt/conversation");
    const page = await BrowserManager.getInstance().getPage();
    activeProvider = new ConversationManager(page);
  }

  return activeProvider;
}

/**
 * Resets the active AI provider cache.
 */
export function resetAIProvider(): void {
  console.log("[AI] Resetting active AI provider instance.");
  activeProvider = null;
}

/**
 * Checks if the active provider has been initialized.
 */
export function isProviderInitialized(): boolean {
  return activeProvider !== null;
}
