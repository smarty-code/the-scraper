import type { Page, Response } from "playwright";

export interface ExtractionResult {
  text: string;
  method: "network" | "dom";
  raw?: string;
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
      if (url.includes("/f/conversation") && url.includes("conversation")) {
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
    // 1. Try Network Interception (Filter out any "/prepare" requests)
    const streamResponse = this.interceptedResponses
      .slice()
      .reverse()
      .find(res => !res.url().includes("/prepare"));

    if (streamResponse) {
      try {
        const rawBody = await streamResponse.text();
        const extracted = this.parseSSEResponse(rawBody);

        if (extracted) {
          return { text: extracted, method: "network", raw: rawBody };
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
   * Supports both new delta_encoding streams and cumulative JSON message models.
   */
  private parseSSEResponse(body: string): string | null {
    const lines = body.split("\n");

    // 1. Try delta_encoding format parser first (collects all text fragment values 'v')
    let deltaText = "";
    let hasDeltas = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
        try {
          const jsonStr = trimmed.substring(6);
          const payload = JSON.parse(jsonStr);
          if (!payload) continue;

          // Case A: Top-level string 'v' (simple text delta)
          if (typeof payload.v === "string") {
            deltaText += payload.v;
            hasDeltas = true;
          }
          // Case B: Top-level array 'v' (patch operations)
          else if (Array.isArray(payload.v)) {
            for (const item of payload.v) {
              if (item && typeof item.p === "string" && item.p.startsWith("/message/content/parts/") && typeof item.v === "string") {
                deltaText += item.v;
                hasDeltas = true;
              }
            }
          }
          // Case C: Top-level patch object with sub-operations
          else if (payload.o === "patch" && Array.isArray(payload.v)) {
            for (const item of payload.v) {
              if (item && typeof item.p === "string" && item.p.startsWith("/message/content/parts/") && typeof item.v === "string") {
                deltaText += item.v;
                hasDeltas = true;
              }
            }
          }
        } catch {
          // Ignore JSON parse errors for incomplete/fragmented SSE lines
        }
      }
    }

    if (hasDeltas && deltaText.trim().length > 0) {
      console.log("[Extractor] Successfully parsed response using delta_encoding stream.");
      return this.cleanChatGPTText(deltaText);
    }

    // 2. Fallback to standard cumulative JSON message parser (scanning backward)
    console.log("[Extractor] Scanning backward for cumulative message payload...");
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
                return this.cleanChatGPTText(fullText);
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
   * Cleans special Unicode entity/citation escape sequences out of the raw text stream.
   * e.g., \ue200entity\ue202["category","Name",...]\ue201 -> Name
   */
  private cleanChatGPTText(text: string): string {
    let cleaned = text;

    // Regex to match the \ue200... \ue202... \ue201 structure
    const entityRegex = /\ue200[^\ue202]*\ue202([\s\S]*?)\ue201/g;

    cleaned = cleaned.replace(entityRegex, (match, jsonArrayStr) => {
      try {
        const arr = JSON.parse(jsonArrayStr);
        if (Array.isArray(arr)) {
          if (arr.length > 1) {
            return arr[1]; // Return the human-readable entity name
          }
          if (arr.length === 1) {
            return `[${arr[0]}]`; // Return standard citation number
          }
        }
      } catch {
        // Fallback: extract the second quoted string if JSON parsing fails on unescaped quote tokens
        const matchSecond = jsonArrayStr.match(/"[^"]*"\s*,\s*"([^"]*)"/);
        if (matchSecond && matchSecond[1]) {
          return matchSecond[1];
        }
      }
      return "";
    });

    // Strip any remaining stray formatting markers
    cleaned = cleaned.replace(/[\ue200\ue201\ue202]/g, "");

    return cleaned;
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
