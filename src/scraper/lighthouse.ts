import { existsSync, promises as fs } from "fs";
import { join } from "path";

export interface LighthouseReport {
  url: string;
  domain: string;
  generatedAt: string;
  report: any;
}

export interface ILighthouseEngine {
  generate(url: string): Promise<LighthouseReport>;
  save(report: LighthouseReport): Promise<void>;
  get(domain: string): Promise<LighthouseReport | null>;
}

/**
 * Extracts the domain name from a URL, stripping "www." if present.
 */
export function getDomain(urlStr: string): string {
  let cleanedUrl = urlStr.trim();
  if (!/^https?:\/\//i.test(cleanedUrl)) {
    cleanedUrl = `https://${cleanedUrl}`;
  }
  try {
    const parsed = new URL(cleanedUrl);
    return parsed.hostname.replace(/^www\./i, "");
  } catch (error) {
    throw new Error(`Invalid URL provided: ${urlStr}`);
  }
}

export class LighthouseEngine implements ILighthouseEngine {
  private reportsDir = join(process.cwd(), "reports");

  /**
   * Generates a report from the Google PageSpeed Insights API.
   */
  async generate(url: string): Promise<LighthouseReport> {
    const domain = getDomain(url);
    
    // Ensure URL has a protocol for the PageSpeed API
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    console.log(`[LighthouseEngine] Querying PageSpeed API for: ${targetUrl} (${domain})`);

    // Standard categories: Performance, Accessibility, Best Practices, SEO
    const categories = ["performance", "accessibility", "best-practices", "seo"];
    const params = new URLSearchParams();
    params.append("url", targetUrl);
    categories.forEach(cat => params.append("category", cat));

    const apiKey = process.env.PAGESPEED_API_KEY;
    if (apiKey) {
      params.append("key", apiKey);
    }

    const apiUrl = `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google PageSpeed API responded with status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      
      return {
        url: targetUrl,
        domain,
        generatedAt: new Date().toISOString(),
        report: data
      };
    } catch (err: any) {
      console.error(`[LighthouseEngine] Error generating report for ${targetUrl}:`, err);
      throw err;
    }
  }

  /**
   * Saves the normalized report to the filesystem at reports/domain.json.
   */
  async save(report: LighthouseReport): Promise<void> {
    await fs.mkdir(this.reportsDir, { recursive: true });
    const filePath = join(this.reportsDir, `${report.domain}.json`);
    
    console.log(`[LighthouseEngine] Saving report to: ${filePath}`);
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
  }

  /**
   * Retrieves an existing report for the domain from the filesystem.
   */
  async get(domain: string): Promise<LighthouseReport | null> {
    const sanitizedDomain = domain.trim().toLowerCase().replace(/^www\./i, "");
    const filePath = join(this.reportsDir, `${sanitizedDomain}.json`);
    
    if (!existsSync(filePath)) {
      console.log(`[LighthouseEngine] Report not found for domain: ${sanitizedDomain}`);
      return null;
    }

    try {
      console.log(`[LighthouseEngine] Reading report from: ${filePath}`);
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as LighthouseReport;
    } catch (err: any) {
      console.error(`[LighthouseEngine] Error reading report for ${sanitizedDomain}:`, err);
      return null;
    }
  }
}

// CLI Direct Runner Support
const isCli = process.argv[1] && (
  process.argv[1].endsWith("lighthouse.ts") || 
  process.argv[1].endsWith("lighthouse.js")
);

if (isCli) {
  const args = process.argv.slice(2);
  const targetUrl = args[0];

  if (!targetUrl) {
    console.error("Usage: bun run src/scraper/lighthouse.ts <url>");
    process.exit(1);
  }

  (async () => {
    try {
      const engine = new LighthouseEngine();
      const report = await engine.generate(targetUrl);
      await engine.save(report);
      console.log(`[Lighthouse CLI] Successfully generated and saved report for ${targetUrl}`);
      process.exit(0);
    } catch (err) {
      console.error("[Lighthouse CLI] Error running execution:", err);
      process.exit(1);
    }
  })();
}
