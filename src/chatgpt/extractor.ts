import type { Page, Response } from "playwright";

export interface ExtractionResult {
  text: string;
  method: "network" | "dom";
}

export class ResponseExtractor {
  private page: Page;
  private interceptedResponses: Response[] = [];

  constructor(page: Page) {
    this.page = page;
    this.setupNetworkInterceptor();
  }

  /**
   * Registers a network listener on the page to collect conversation api responses.
   */
  private setupNetworkInterceptor() {
    this.page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/backend-api/conversation")) {
        console.log(`[Extractor] Intercepted conversation API response: ${url} (status: ${response.status()})`);
        this.interceptedResponses.push(response);
      }
    });
  }

  /**
   * Resets the captured response list before a new prompt run.
   */
  public reset() {
    this.interceptedResponses = [];
  }

  /**
   * Attempts to extract the generated text by parsing the last intercepted network response.
   * Falls back to DOM scraping if network interception yields no result.
   */
  public async extractResponse(): Promise<ExtractionResult> {
    // 1. Try Network Interception
    if (this.interceptedResponses.length > 0) {
      try {
        // Look at the latest intercepted response
        const response = this.interceptedResponses[this.interceptedResponses.length - 1];
        const rawBody = await response.text();
        const extracted = this.parseSSEResponse(rawBody);
        
        if (extracted) {
          return { text: extracted, method: "network" };
        }
      } catch (err) {
        console.warn("[Extractor] Failed to extract from network response, falling back to DOM:", err);
      }
    }

    // 2. Fallback to DOM Scraping
    console.log("[Extractor] Attempting DOM-based response extraction...");
    const domText = await this.extractFromDOM();
    if (domText) {
      return { text: domText, method: "dom" };
    }

    throw new Error("Failed to extract response from both network and DOM");
  }

  /**
   * Parses the ChatGPT Server-Sent Events (SSE) body and extracts the final message content.
   */
  private parseSSEResponse(body: string): string | null {
    const lines = body.split("\n");
    
    // Scan backward to find the final complete message payload
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const jsonStr = line.substring(6); // Strip "data: "
          const payload = JSON.parse(jsonStr);
          
          if (payload.message?.author?.role === "assistant") {
            const parts = payload.message.content?.parts;
            if (Array.isArray(parts) && parts.length > 0) {
              const fullText = parts.join("");
              if (fullText.trim().length > 0) {
                return fullText;
              }
            }
          }
        } catch {
          // Ignore JSON parse errors for incomplete/fragmented SSE lines
        }
      }
    }
    return null;
  }

  /**
   * Scrapes the text of the latest assistant message from the page DOM.
   */
  private async extractFromDOM(): Promise<string | null> {
    try {
      const assistantMessages = await this.page.$$eval(
        '[data-message-author-role="assistant"]',
        (elements) => elements.map((el) => (el as HTMLElement).innerText)
      );

      if (assistantMessages.length > 0) {
        // Return the last message text
        return assistantMessages[assistantMessages.length - 1];
      }
    } catch (err) {
      console.error("[Extractor] DOM extraction failed:", err);
    }
    return null;
  }
}
