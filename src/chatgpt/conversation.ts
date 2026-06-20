import { Page } from "playwright";
import { BrowserManager } from "../browser/browser";
import { submitPrompt } from "./prompt";
import { waitForGenerationComplete } from "./watcher";
import { ResponseExtractor } from "./extractor";

export interface AskResult {
  success: boolean;
  answer?: string;
  rawResponse?: string;
  method?: "network" | "dom";
  conversationId?: string | null;
  error?: string;
}

export class ConversationManager {
  private page: Page;
  private extractor: ResponseExtractor;
  private authToken: string | null = null;

  constructor(page: Page) {
    this.page = page;
    this.extractor = new ResponseExtractor(page);
    this.setupAuthTokenInterceptor();
  }

  /**
   * Listens to outgoing requests to capture the Bearer Auth token from ChatGPT API calls.
   */
  private setupAuthTokenInterceptor() {
    this.page.on("request", (request) => {
      const headers = request.headers();
      const authHeader = headers["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ") && (request.url().includes("/backend-api/") || request.url().includes("/backend-anon/"))) {
        if (this.authToken !== authHeader) {
          this.authToken = authHeader;
          console.log("[Conversation] Successfully captured/updated ChatGPT API Bearer token.");
        }
      }
    });
  }

  /**
   * Executes a prompt on ChatGPT.
   * 
   * @param prompt The prompt to execute
   * @param deleteConv Whether to archive/delete the conversation afterwards to avoid context clutter
   */
  public async ask(prompt: string, deleteConv = true): Promise<AskResult> {
    try {
      console.log("[Conversation] Preparing network interceptor...");
      
      // Load root URL with prompt query parameter to automatically pre-fill
      const targetUrl = `https://chatgpt.com/?prompt=${encodeURIComponent(prompt)}`;
      
      // Reset extractor state
      this.extractor.reset();

      // Listen for the next POST conversation API call BEFORE navigating
      // to capture both auto-submitted and manually submitted queries.
      // Make sure we check for /f/conversation and exclude /prepare.
      const responsePromise = this.page.waitForResponse(
        res => res.url().includes("/f/conversation") && !res.url().includes("/prepare") && res.request().method() === "POST",
        { timeout: 45000 }
      ).catch(() => null);

      console.log("[Conversation] Navigating to ChatGPT with prompt URL parameter...");
      await this.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      
      // Check if we are logged in (prompt textarea must exist)
      try {
        await this.page.waitForSelector("#prompt-textarea", { timeout: 15000 });
      } catch (err) {
        throw new Error("ChatGPT textarea not found. Session might be expired or not logged in. Please run 'bun run src/browser/session.ts' to authenticate.");
      }

      // Submit the prompt (this will either let the auto-submit continue or click the submit button)
      await submitPrompt(this.page, prompt);

      console.log("[Conversation] Waiting for conversation network stream response...");
      const response = await responsePromise;

      if (response) {
        console.log("[Conversation] Intercepted stream response. Waiting for network completion...");
        try {
          // Wait for the full body stream to finish downloading
          await response.finished();
          console.log("[Conversation] Network stream completed.");
        } catch (err) {
          console.warn("[Conversation] Error waiting for network completion:", err);
        }
      } else {
        console.log("[Conversation] No conversation response intercepted.");
      }

      // Extract response (automatically falls back to DOM if network failed or parsing is empty)
      const extraction = await this.extractor.extractResponse();
      
      // Extract Conversation ID from URL
      const currentUrl = this.page.url();
      const match = currentUrl.match(/\/c\/([a-f0-9\-]+)/);
      const conversationId = match ? match[1] : null;
      console.log(`[Conversation] Active Conversation ID: ${conversationId || "unknown"}`);

      // Save the storage state (updates session tokens/cookies)
      await BrowserManager.getInstance().persistSession();

      // Clean up/delete the conversation if requested
      if (deleteConv && conversationId) {
        await this.archiveConversation(conversationId);
      }

      return {
        success: true,
        answer: extraction.text,
        rawResponse: extraction.raw || "",
        method: extraction.method,
        conversationId
      };
    } catch (error: any) {
      console.error("[Conversation] Error during Ask execution:", error);
      return {
        success: false,
        error: error.message || String(error)
      };
    }
  }

  /**
   * Deletes/archives a conversation via ChatGPT backend-api to keep history clean.
   */
  private async archiveConversation(conversationId: string): Promise<void> {
    if (!this.authToken) {
      console.warn("[Conversation] Skipping archive: No Authorization Bearer token captured yet.");
      return;
    }

    console.log(`[Conversation] Archiving conversation ${conversationId} via API...`);
    try {
      // Execute a patch request directly within the browser page context to avoid CORS or IP mismatch
      const success = await this.page.evaluate(
        async ({ id, token }) => {
          try {
            const res = await fetch(`https://chatgpt.com/backend-api/conversation/${id}`, {
              method: "PATCH",
              headers: {
                "Authorization": token,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ is_visible: false })
            });
            return res.ok;
          } catch (e) {
            console.error("Fetch failed:", e);
            return false;
          }
        },
        { id: conversationId, token: this.authToken }
      );

      if (success) {
        console.log(`[Conversation] Conversation ${conversationId} successfully archived.`);
      } else {
        console.warn(`[Conversation] API call to archive conversation ${conversationId} returned a non-2xx response status.`);
      }
    } catch (err) {
      console.warn("[Conversation] Failed to archive conversation via API evaluate:", err);
    }
  }
}
