import { BrowserManager } from "../browser/browser";
import { ConversationManager, AskResult } from "../chatgpt/conversation";
import { TaskQueue } from "../queue/worker";
import { hasSession, deleteSession } from "../browser/cookies";
import { LighthouseEngine } from "../scraper/lighthouse";

const queue = new TaskQueue(1);
let conversationManager: ConversationManager | null = null;
const lighthouseEngine = new LighthouseEngine();

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

  <div class="endpoint">
    <h3><span class="method">POST</span><code>/scrape</code></h3>
    <p>Perform Google SERP scraping and run the AI refinement & ranking pipeline. Saves raw data to <code>crawler_data</code> and refined data (confidence >= 0.5) to <code>refined_scrapes</code> collections in MongoDB.</p>
    <pre><code>curl -X POST http://localhost:${url.port || "3000"}/scrape \\
  -H "Content-Type: application/json" \\
  -d '{"keyword": "reddit marketing tool", "startPage": 1, "endPage": 1, "instructions": "Only tools or SaaS for automation"}'</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">GET</span><code>/api/keywords</code></h3>
    <p>List all scraped/refined keywords with timestamps, result counts, and refinement status.</p>
    <pre><code>curl http://localhost:${url.port || "3000"}/api/keywords</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">GET</span><code>/api/scrapes</code></h3>
    <p>List all raw scrape records (summaries: keyword, timestamp, page count, result count).</p>
    <pre><code>curl http://localhost:${url.port || "3000"}/api/scrapes</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">GET</span><code>/api/scrapes/:keyword</code></h3>
    <p>Retrieve full raw scrape data (all pages and organic results) for a specific keyword.</p>
    <pre><code>curl http://localhost:${url.port || "3000"}/api/scrapes/reddit%20marketing%20tool</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">GET</span><code>/api/refined/:keyword</code></h3>
    <p>Retrieve the latest saved AI refined search results for a keyword from MongoDB.</p>
    <pre><code>curl http://localhost:${url.port || "3000"}/api/refined/reddit%20marketing%20tool</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span><code>/api/lighthouse</code></h3>
    <p>Submit a URL for a Lighthouse audit report via Google PageSpeed API. Stored in MongoDB.</p>
    <pre><code>curl -X POST http://localhost:${url.port || "3000"}/api/lighthouse \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://github.com"}'</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">GET</span><code>/api/lighthouse</code></h3>
    <p>List all audited domains with their latest performance scores.</p>
    <pre><code>curl http://localhost:${url.port || "3000"}/api/lighthouse</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">GET</span><code>/api/lighthouse/:domain</code></h3>
    <p>Retrieve the full Lighthouse audit report for a specific domain from MongoDB.</p>
    <pre><code>curl http://localhost:${url.port || "3000"}/api/lighthouse/github.com</code></pre>
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

  // POST /scrape (Standalone Google scraper + AI Refinement)
  if (url.pathname === "/scrape" && req.method === "POST") {
    try {
      const body = await req.json();
      const keyword = body.keyword;
      const startPage = parseInt(body.startPage, 10) || 1;
      const endPage = parseInt(body.endPage, 10) || startPage;
      const instructions = body.instructions || "";

      if (!keyword || typeof keyword !== "string") {
        return new Response(JSON.stringify({ success: false, error: "keyword field is required and must be a string." }), { status: 400, headers });
      }

      console.log(`[API] Scrape and Refine request for keyword: "${keyword}" (Pages ${startPage} to ${endPage})`);

      const result = await queue.add<any>(async () => {
        // 1. Scrape Google results (saves raw results to crawler_data collection in MongoDB)
        const { scrapeGoogle } = await import("../scraper/google");
        const rawPayload = await scrapeGoogle(keyword, startPage, endPage);

        // Collect all items
        const allResults: any[] = [];
        for (const page of rawPayload.pages) {
          if (Array.isArray(page.results)) {
            allResults.push(...page.results);
          }
        }

        // 2. Refine results via ChatGPT (saves filtered results to refined_scrapes collection in MongoDB)
        const { refineResults, saveRefinedScrape } = await import("../scraper/refine");
        const manager = await getConversationManager();
        
        let refinedResults: any[] = [];
        let refinementError: string | null = null;
        try {
          refinedResults = await refineResults(manager, keyword, allResults, instructions);
          await saveRefinedScrape(keyword, instructions, refinedResults);
        } catch (refineErr: any) {
          console.error("[API] Refinement failed:", refineErr);
          refinementError = refineErr.message || String(refineErr);
        }

        return {
          keyword,
          pagesScraped: rawPayload.pages.length,
          rawResultsCount: allResults.length,
          refinedResultsCount: refinedResults.length,
          refinedResults,
          error: refinementError
        };
      });

      if (result.error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Refinement failed: " + result.error,
            rawResultsCount: result.rawResultsCount
          }),
          { status: 500, headers }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          keyword: result.keyword,
          pagesScraped: result.pagesScraped,
          rawResultsCount: result.rawResultsCount,
          refinedResultsCount: result.refinedResultsCount,
          refinedResults: result.refinedResults
        }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: "Scraping and refinement pipeline failed: " + err.message }), { status: 500, headers });
    }
  }

  // GET /api/refined/:keyword (Read AI-refined scraper results)
  if (url.pathname.startsWith("/api/refined/") && req.method === "GET") {
    try {
      const encodedKeyword = url.pathname.slice("/api/refined/".length);
      const keyword = decodeURIComponent(encodedKeyword).trim();
      if (!keyword) {
        return new Response(
          JSON.stringify({ success: false, error: "Keyword is required." }),
          { status: 400, headers }
        );
      }

      console.log(`[API] Fetching refined scraper results for keyword: "${keyword}"`);
      const { connectToDatabase } = await import("../database/mongo");
      const { REFINED_SCRAPES_COLLECTION } = await import("../database/models");
      const db = await connectToDatabase();
      const doc = await db.collection(REFINED_SCRAPES_COLLECTION).findOne({ keyword });

      if (!doc) {
        return new Response(
          JSON.stringify({ success: false, error: `Refined scraper results not found for keyword: ${keyword}` }),
          { status: 404, headers }
        );
      }

      return new Response(
        JSON.stringify({
          keyword: doc.keyword,
          refinedAt: doc.refinedAt,
          instructions: doc.instructions,
          results: doc.results
        }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to retrieve refined scraper results: " + err.message }),
        { status: 500, headers }
      );
    }
  }

  // GET /api/keywords (List all scraped/refined keywords)
  if (url.pathname === "/api/keywords" && req.method === "GET") {
    try {
      console.log("[API] Fetching all keyword records...");
      const { connectToDatabase } = await import("../database/mongo");
      const { CRAWLER_DATA_COLLECTION, REFINED_SCRAPES_COLLECTION } = await import("../database/models");
      const db = await connectToDatabase();

      // Fetch all raw scrape keywords
      const rawDocs = await db.collection(CRAWLER_DATA_COLLECTION)
        .find({}, { projection: { keyword: 1, scrapedAt: 1, pages: 1, _id: 0 } })
        .toArray();

      // Fetch all refined keywords
      const refinedDocs = await db.collection(REFINED_SCRAPES_COLLECTION)
        .find({}, { projection: { keyword: 1, refinedAt: 1, results: 1, instructions: 1, _id: 0 } })
        .toArray();

      // Build a merged keyword index
      const refinedMap = new Map<string, any>();
      for (const rd of refinedDocs) {
        refinedMap.set(rd.keyword, rd);
      }

      const keywords = rawDocs.map(doc => {
        const totalResults = doc.pages?.reduce((sum: number, p: any) => sum + (p.results?.length || 0), 0) || 0;
        const refined = refinedMap.get(doc.keyword);
        return {
          keyword: doc.keyword,
          scrapedAt: doc.scrapedAt,
          pagesScraped: doc.pages?.length || 0,
          rawResultsCount: totalResults,
          hasRefinedData: !!refined,
          refinedAt: refined?.refinedAt || null,
          refinedResultsCount: refined?.results?.length || 0,
          instructions: refined?.instructions || null
        };
      });

      return new Response(
        JSON.stringify({ success: true, count: keywords.length, keywords }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to list keywords: " + err.message }),
        { status: 500, headers }
      );
    }
  }

  // GET /api/scrapes (List all raw scrape summaries)
  if (url.pathname === "/api/scrapes" && req.method === "GET") {
    try {
      console.log("[API] Fetching all raw scrape summaries...");
      const { connectToDatabase } = await import("../database/mongo");
      const { CRAWLER_DATA_COLLECTION } = await import("../database/models");
      const db = await connectToDatabase();

      const docs = await db.collection(CRAWLER_DATA_COLLECTION)
        .find({}, { projection: { _id: 0 } })
        .sort({ scrapedAt: -1 })
        .toArray();

      const summaries = docs.map(doc => ({
        keyword: doc.keyword,
        scrapedAt: doc.scrapedAt,
        pagesScraped: doc.pages?.length || 0,
        rawResultsCount: doc.pages?.reduce((sum: number, p: any) => sum + (p.results?.length || 0), 0) || 0
      }));

      return new Response(
        JSON.stringify({ success: true, count: summaries.length, scrapes: summaries }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to list scrapes: " + err.message }),
        { status: 500, headers }
      );
    }
  }

  // GET /api/scrapes/:keyword (Read full raw scrape data for a keyword)
  if (url.pathname.startsWith("/api/scrapes/") && req.method === "GET") {
    try {
      const encodedKeyword = url.pathname.slice("/api/scrapes/".length);
      const keyword = decodeURIComponent(encodedKeyword).trim();
      if (!keyword) {
        return new Response(
          JSON.stringify({ success: false, error: "Keyword is required." }),
          { status: 400, headers }
        );
      }

      console.log(`[API] Fetching raw scrape data for keyword: "${keyword}"`);
      const { connectToDatabase } = await import("../database/mongo");
      const { CRAWLER_DATA_COLLECTION } = await import("../database/models");
      const db = await connectToDatabase();
      const doc = await db.collection(CRAWLER_DATA_COLLECTION).findOne(
        { keyword },
        { projection: { _id: 0 } }
      );

      if (!doc) {
        return new Response(
          JSON.stringify({ success: false, error: `Raw scrape data not found for keyword: ${keyword}` }),
          { status: 404, headers }
        );
      }

      return new Response(
        JSON.stringify({
          keyword: doc.keyword,
          scrapedAt: doc.scrapedAt,
          pagesScraped: doc.pages?.length || 0,
          rawResultsCount: doc.pages?.reduce((sum: number, p: any) => sum + (p.results?.length || 0), 0) || 0,
          pages: doc.pages
        }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to retrieve raw scrape data: " + err.message }),
        { status: 500, headers }
      );
    }
  }

  // POST /api/lighthouse (Generate Lighthouse report)
  if (url.pathname === "/api/lighthouse" && req.method === "POST") {
    try {
      const body = await req.json();
      const targetUrl = body.url;

      if (!targetUrl || typeof targetUrl !== "string") {
        return new Response(
          JSON.stringify({ success: false, error: "url field is required and must be a string." }),
          { status: 400, headers }
        );
      }

      console.log(`[API] Lighthouse audit request received for URL: ${targetUrl}`);
      const report = await lighthouseEngine.generate(targetUrl);
      await lighthouseEngine.save(report);

      return new Response(
        JSON.stringify({
          success: true,
          domain: report.domain,
          saved: true,
          path: `MongoDB collection: lighthouse_reports`
        }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: "Lighthouse generation failed: " + err.message }),
        { status: 500, headers }
      );
    }
  }

  // GET /api/lighthouse (List all audited domains)
  if (url.pathname === "/api/lighthouse" && req.method === "GET") {
    try {
      console.log("[API] Fetching all lighthouse report summaries...");
      const { connectToDatabase } = await import("../database/mongo");
      const { LIGHTHOUSE_REPORTS_COLLECTION } = await import("../database/models");
      const db = await connectToDatabase();

      const docs = await db.collection(LIGHTHOUSE_REPORTS_COLLECTION)
        .find({}, { projection: { _id: 0, domain: 1, url: 1, generatedAt: 1, "report.lighthouseResult.categories": 1 } })
        .sort({ generatedAt: -1 })
        .toArray();

      const summaries = docs.map(doc => {
        const cats = doc.report?.lighthouseResult?.categories || {};
        return {
          domain: doc.domain,
          url: doc.url,
          generatedAt: doc.generatedAt,
          scores: {
            performance: cats.performance?.score ?? null,
            accessibility: cats.accessibility?.score ?? null,
            bestPractices: cats["best-practices"]?.score ?? null,
            seo: cats.seo?.score ?? null
          }
        };
      });

      return new Response(
        JSON.stringify({ success: true, count: summaries.length, reports: summaries }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to list lighthouse reports: " + err.message }),
        { status: 500, headers }
      );
    }
  }

  // GET /api/lighthouse/:domain (Read existing Lighthouse report)
  if (url.pathname.startsWith("/api/lighthouse/") && req.method === "GET") {
    try {
      const domain = url.pathname.slice("/api/lighthouse/".length);
      if (!domain) {
        return new Response(
          JSON.stringify({ success: false, error: "Domain name is required." }),
          { status: 400, headers }
        );
      }

      console.log(`[API] Lighthouse get report request received for domain: ${domain}`);
      const report = await lighthouseEngine.get(domain);

      if (!report) {
        return new Response(
          JSON.stringify({ success: false, error: `Lighthouse report not found for domain: ${domain}` }),
          { status: 404, headers }
        );
      }

      return new Response(
        JSON.stringify({
          domain: report.domain,
          url: report.url,
          generatedAt: report.generatedAt,
          report: report.report
        }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to retrieve Lighthouse report: " + err.message }),
        { status: 500, headers }
      );
    }
  }

  // 404 Route
  return new Response(JSON.stringify({ error: "Endpoint not found" }), { status: 404, headers });
}
