import { existsSync, promises as fs } from "fs";
import { join } from "path";
import { BrowserManager } from "../browser/browser";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scrapes Google Search Results for a keyword across a range of pages.
 * Saves results as a structured JSON file.
 */
export async function scrapeGoogle(keyword: string, startPage: number, endPage: number) {
  console.log(`[Scraper] Starting Google scrape for: "${keyword}" (Pages ${startPage} to ${endPage})`);
  
  const pagesData: any[] = [];
  const browserManager = BrowserManager.getInstance();
  const page = await browserManager.getPage();

  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const start = (pageNum - 1) * 10;
    const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&start=${start}`;
    console.log(`[Scraper] Navigating to page ${pageNum}: ${url}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      
      // Random human-like delay between 2-4 seconds to avoid triggers/CAPTCHAs
      const waitTime = 2000 + Math.random() * 2000;
      await delay(waitTime);

      const html = await page.content();

      // Extract results from DOM
      const results = await page.evaluate(() => {
        const data: any[] = [];
        const blocks = document.querySelectorAll("div.g");
        
        blocks.forEach((block, index) => {
          const titleEl = block.querySelector("h3");
          const linkEl = block.querySelector("a");
          const snippetEl = block.querySelector(".VwiC3b, .yDAB2d, .s3v9zd, .MUbPIb, [style*='-webkit-line-clamp']");

          if (titleEl && linkEl) {
            data.push({
              position: index + 1,
              title: (titleEl as HTMLElement).innerText || "",
              url: linkEl.href || "",
              snippet: snippetEl ? (snippetEl as HTMLElement).innerText : ""
            });
          }
        });

        // Fallback: If div.g selector wasn't matched (e.g. Google changed markup), query by h3
        if (data.length === 0) {
          const headers = document.querySelectorAll("h3");
          headers.forEach((h3, index) => {
            const parentA = h3.closest("a");
            if (parentA) {
              let snippet = "";
              let current = parentA.parentElement;
              for (let i = 0; i < 3 && current; i++) {
                const next = current.nextElementSibling;
                if (next && (next.querySelector(".VwiC3b") || next.innerText.length > 50)) {
                  snippet = (next as HTMLElement).innerText;
                  break;
                }
                current = current.parentElement;
              }
              data.push({
                position: index + 1,
                title: (h3 as HTMLElement).innerText || "",
                url: parentA.href || "",
                snippet: snippet
              });
            }
          });
        }
        return data;
      });

      console.log(`[Scraper] Page ${pageNum}: Extracted ${results.length} results.`);
      
      pagesData.push({
        pageNumber: pageNum,
        url,
        html,
        results
      });

    } catch (err: any) {
      console.error(`[Scraper] Failed to scrape page ${pageNum}:`, err);
      pagesData.push({
        pageNumber: pageNum,
        url,
        html: "",
        results: [],
        error: err.message || String(err)
      });
    }
  }

  const payload = {
    keyword,
    scrapedAt: new Date().toISOString(),
    pages: pagesData
  };

  // Format file name: raw_<sanitized_query>.json
  const sanitized = keyword.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const filename = `raw_${sanitized}.json`;
  
  const outputDir = join(process.cwd(), "data", "raw");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, filename);

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`[Scraper] Saved results to: ${outputPath}`);

  return payload;
}

// CLI Direct Runner Support
const isCli = process.argv[1] && (
  process.argv[1].endsWith("google.ts") || 
  process.argv[1].endsWith("google.js")
);

if (isCli) {
  const args = process.argv.slice(2);
  const keyword = args[0];
  const startPage = parseInt(args[1], 10) || 1;
  const endPage = parseInt(args[2], 10) || startPage;

  if (!keyword) {
    console.error("Usage: bun run src/scraper/google.ts <keyword> [startPage=1] [endPage=startPage]");
    process.exit(1);
  }

  (async () => {
    try {
      await scrapeGoogle(keyword, startPage, endPage);
      await BrowserManager.getInstance().close();
      process.exit(0);
    } catch (err) {
      console.error("[Scraper CLI] Error during scraping execution:", err);
      process.exit(1);
    }
  })();
}
