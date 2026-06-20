import { BrowserManager } from "../browser/browser";
import { ConversationManager, AskResult } from "../chatgpt/conversation";
import { TaskQueue } from "../queue/worker";
import { hasSession, deleteSession } from "../browser/cookies";

const queue = new TaskQueue(1);
let conversationManager: ConversationManager | null = null;

/**
 * Lazy loads and returns the conversation manager.
 * If browser context was closed, recreates it.
 */
async function getConversationManager(): Promise<ConversationManager> {
  const page = await BrowserManager.getInstance().getPage();
  if (!conversationManager) {
    conversationManager = new ConversationManager(page);
  }
  return conversationManager;
}

/**
 * Reset conversation manager cache (used on error).
 */
function resetConversationManager() {
  conversationManager = null;
}

/**
 * Helper to parse, extract, or convert the ChatGPT generated text to a JSON payload.
 */
function parseOrFormatResponse(answer: string): { status: number; body: any } {
  const trimmed = answer.trim();

  // Helper to strip markdown JSON blocks
  const cleanMarkdown = (str: string): string => {
    let cleaned = str;
    cleaned = cleaned.replace(/^```json\s*/i, "");
    cleaned = cleaned.replace(/^```\s*/, "");
    cleaned = cleaned.replace(/\s*```$/, "");
    return cleaned.trim();
  };

  const cleaned = cleanMarkdown(trimmed);

  // Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    return { status: 200, body: parsed };
  } catch {}

  // Try extracting JSON object brackets
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      return { status: 200, body: parsed };
    } catch {}
  }

  // Try extracting JSON array brackets
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const parsed = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
      return { status: 200, body: parsed };
    } catch {}
  }

  // Fallback: If it's not JSON, convert it to JSON (wrap it in an object)
  try {
    return {
      status: 200,
      body: { answer: trimmed }
    };
  } catch (err: any) {
    return {
      status: 400,
      body: { success: false, error: "Response is not in JSON format data and could not be converted." }
    };
  }
}

/**
 * Main HTTP request handler compatible with Bun.serve
 */
export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  // Handle CORS preflight options
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // GET / (Home documentation dashboard)
  if (url.pathname === "/" && req.method === "GET") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ChatGPT Browser Automation API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; background: #121212; color: #e0e0e0; }
    h1 { color: #10a37f; border-bottom: 1px solid #333; padding-bottom: 10px; }
    h2 { color: #f0f0f0; margin-top: 30px; }
    pre { background: #1e1e1e; padding: 15px; border-radius: 6px; overflow-x: auto; border: 1px solid #333; color: #a9b7c6; font-size: 14px; }
    code { font-family: Consolas, Monaco, monospace; }
    .endpoint { background: #1a1a1a; padding: 15px; border-radius: 6px; border: 1px solid #2d2d2d; border-left: 4px solid #10a37f; margin-bottom: 20px; }
    .method { font-weight: bold; color: #10a37f; background: rgba(16, 163, 127, 0.1); padding: 2px 8px; border-radius: 4px; font-size: 14px; margin-right: 10px; }
    a { color: #10a37f; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>ChatGPT Browser Automation Layer</h1>
  <p>A lightweight internal API service powered by your active ChatGPT session.</p>
  
  <h2>API Status</h2>
  <p>Check the server status page here: <a href="/status">/status</a></p>

  <h2>Available Endpoints</h2>
  
  <div class="endpoint">
    <h3><span class="method">POST</span><code>/ask</code></h3>
    <p>Submit a prompt request. Enqueues the request to be processed sequentially by the browser.</p>
    <pre><code>curl -X POST http://localhost:${url.port || "3000"}/ask \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Explain photosynthesis in 2 sentences.", "deleteConversation": true}'</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">GET</span><code>/status</code></h3>
    <p>Get status of the browser instance and request queue.</p>
    <pre><code>curl http://localhost:${url.port || "3000"}/status</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span><code>/login</code></h3>
    <p>Trigger headed browser context on host to manually log in and update cookies.</p>
    <pre><code>curl -X POST http://localhost:${url.port || "3000"}/login</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span><code>/session/reset</code></h3>
    <p>Reset cookies, clear local session, and close browser context.</p>
    <pre><code>curl -X POST http://localhost:${url.port || "3000"}/session/reset</code></pre>
  </div>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: new Headers({ "Content-Type": "text/html" })
    });
  }

  // GET /status
  if (url.pathname === "/status" && req.method === "GET") {
    return new Response(
      JSON.stringify({
        initialized: conversationManager !== null,
        hasSession: hasSession(),
        queue: {
          pending: queue.getPendingLength(),
          active: queue.getActiveCount()
        }
      }),
      { status: 200, headers }
    );
  }

  // POST /login (Trigger manual login setup)
  if (url.pathname === "/login" && req.method === "POST") {
    // Launch interactive login in a separate non-blocking promise
    // because manual login might take minutes.
    setTimeout(async () => {
      try {
        resetConversationManager();
        await BrowserManager.getInstance().runInteractiveLogin();
      } catch (err) {
        console.error("[API] Manual login failed:", err);
      }
    }, 0);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Interactive headed login started in background. Please log in on the host machine's browser screen."
      }),
      { status: 200, headers }
    );
  }

  // POST /session/reset (Clear session cache)
  if (url.pathname === "/session/reset" && req.method === "POST") {
    try {
      resetConversationManager();
      await BrowserManager.getInstance().close();
      await deleteSession();
      return new Response(JSON.stringify({ success: true, message: "Session cleared successfully." }), { status: 200, headers });
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers });
    }
  }

  // GET /ask (Explain POST requirement)
  if (url.pathname === "/ask" && req.method === "GET") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Method Not Allowed. Use POST to send prompts.",
        usage: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: { prompt: "Your prompt text here", deleteConversation: true }
        }
      }),
      { status: 405, headers }
    );
  }

  // POST /ask (Submit prompt)
  if (url.pathname === "/ask" && req.method === "POST") {
    try {
      const body = await req.json();
      const prompt = body.prompt;
      const deleteConv = body.deleteConversation !== false;

      if (!prompt || typeof prompt !== "string") {
        return new Response(JSON.stringify({ success: false, error: "Prompt field is required and must be a string." }), { status: 400, headers });
      }

      console.log(`[API] Enqueuing prompt request: "${prompt.slice(0, 40)}..." (Pending queue size: ${queue.getPendingLength()})`);

      // Add prompt execution to the task queue
      const result = await queue.add<AskResult>(async () => {
        try {
          const manager = await getConversationManager();
          let res = await manager.ask(prompt, deleteConv);
          
          // Re-try once if target was closed/crashed
          if (!res.success && res.error && (res.error.includes("Target closed") || res.error.includes("context has been closed"))) {
            console.log("[API] Target closed. Re-initializing browser session and retrying...");
            resetConversationManager();
            await BrowserManager.getInstance().close();
            const retryManager = await getConversationManager();
            res = await retryManager.ask(prompt, deleteConv);
          }
          
          return res;
        } catch (err: any) {
          return { success: false, error: err.message || String(err) };
        }
      });

      if (result.success) {
        const parsedResponse = parseOrFormatResponse(result.answer);
        return new Response(
          JSON.stringify(parsedResponse.body),
          { status: parsedResponse.status, headers }
        );
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: result.error
          }),
          { status: 500, headers }
        );
      }
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: "Invalid JSON body: " + err.message }), { status: 400, headers });
    }
  }

  // POST /scrape (Standalone Google scraper)
  if (url.pathname === "/scrape" && req.method === "POST") {
    try {
      const body = await req.json();
      const keyword = body.keyword;
      const startPage = parseInt(body.startPage, 10) || 1;
      const endPage = parseInt(body.endPage, 10) || startPage;

      if (!keyword || typeof keyword !== "string") {
        return new Response(JSON.stringify({ success: false, error: "keyword field is required and must be a string." }), { status: 400, headers });
      }

      console.log(`[API] Standalone scraper request for: "${keyword}" (Pages ${startPage} to ${endPage})`);

      const result = await queue.add<any>(async () => {
        const { scrapeGoogle } = await import("../scraper/google");
        return await scrapeGoogle(keyword, startPage, endPage);
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully scraped pages ${startPage} to ${endPage} for keyword: ${keyword}`,
          data: {
            keyword: result.keyword,
            scrapedAt: result.scrapedAt,
            pagesCount: result.pages.length
          }
        }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: "Scraping failed: " + err.message }), { status: 500, headers });
    }
  }

  // 404 Route
  return new Response(JSON.stringify({ error: "Endpoint not found" }), { status: 404, headers });
}
