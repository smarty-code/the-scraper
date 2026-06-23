import "../polyfill";
import { 
  WEBSITE_AGES_COLLECTION, 
  WebsiteAgeDoc 
} from "../database/models";
import { getDomain } from "./lighthouse";

export interface IWebsiteAgeEngine {
  generate(url: string): Promise<WebsiteAgeDoc>;
  save(report: WebsiteAgeDoc): Promise<void>;
  get(domain: string): Promise<WebsiteAgeDoc | null>;
}

export function parseSparkline(data: any): { earliestYear?: number, earliestMonth?: number, earliestArchiveDate?: string } {
  if (!data || !data.years || typeof data.years !== "object") {
    return {};
  }
  
  // Sort years ascending to find the earliest
  const years = Object.keys(data.years)
    .map(Number)
    .filter(y => !isNaN(y))
    .sort((a, b) => a - b);
    
  for (const year of years) {
    const monthlyCounts = data.years[year];
    if (Array.isArray(monthlyCounts)) {
      // Find the first month (0-indexed) with a count > 0
      const monthIdx = monthlyCounts.findIndex(count => count > 0);
      if (monthIdx !== -1) {
        const earliestMonth = monthIdx + 1; // 1-indexed (1-12)
        const earliestArchiveDate = `${year}-${String(earliestMonth).padStart(2, "0")}`;
        return {
          earliestYear: year,
          earliestMonth,
          earliestArchiveDate
        };
      }
    }
  }
  
  return {};
}

export class WebsiteAgeEngine implements IWebsiteAgeEngine {
  /**
   * Generates a website age report from Wayback Machine APIs.
   */
  async generate(url: string): Promise<WebsiteAgeDoc> {
    const domain = getDomain(url);
    
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    console.log(`[WebsiteAgeEngine] Checking availability for: ${targetUrl} (${domain})`);

    // 1. Check availability
    const checkUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}`;
    let checkRes;
    try {
      checkRes = await fetch(checkUrl);
    } catch (fetchErr: any) {
      throw new Error(`Failed to query availability API: ${fetchErr.message}`);
    }

    if (checkRes.status !== 200) {
      console.log(`[WebsiteAgeEngine] Availability check returned non-200: ${checkRes.status}`);
      return {
        url: targetUrl,
        domain,
        checkedAt: new Date().toISOString(),
        available: false
      };
    }

    const checkData = await checkRes.json();
    const hasSnapshots = !!(checkData?.archived_snapshots?.closest?.available);

    if (!hasSnapshots) {
      console.log(`[WebsiteAgeEngine] Domain ${domain} is not available in Wayback Machine.`);
      return {
        url: targetUrl,
        domain,
        checkedAt: new Date().toISOString(),
        available: false
      };
    }

    console.log(`[WebsiteAgeEngine] Domain is available. Fetching sparkline history...`);

    // 2. Fetch sparkline data
    const sparklineUrl = `https://web.archive.org/__wb/sparkline?output=json&url=${encodeURIComponent(targetUrl)}&collection=web`;
    
    // Construct request headers to mimic the browser exactly per requirements
    const headers = {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9,bn;q=0.8",
      "priority": "u=1, i",
      "referer": `https://web.archive.org/web/20260000000000*/${encodeURIComponent(targetUrl)}`,
      "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      "Cookie": "donation-identifier=fd69bdb34b8ce5af80e92c7630d7d1ac; abtest-identifier=7c36891746da1a1fb2a92cfab294480a; view-search=tiles; showdetails-search=; wb-cdx-ui-SERVER=wwwb-app252; wb-p-SERVER=wwwb-app221; wb-save-SERVER=wwwb-app55"
    };

    let sparklineRes;
    try {
      sparklineRes = await fetch(sparklineUrl, { headers });
    } catch (sparkErr: any) {
      throw new Error(`Failed to query Wayback sparkline API: ${sparkErr.message}`);
    }

    if (!sparklineRes.ok) {
      console.log(`[WebsiteAgeEngine] Sparkline API returned status ${sparklineRes.status}`);
      return {
        url: targetUrl,
        domain,
        checkedAt: new Date().toISOString(),
        available: true
      };
    }

    const sparklineData = await sparklineRes.json();
    const { earliestYear, earliestMonth, earliestArchiveDate } = parseSparkline(sparklineData);

    const currentYear = new Date().getFullYear();
    const ageInYears = earliestYear ? (currentYear - earliestYear) : undefined;

    return {
      url: targetUrl,
      domain,
      checkedAt: new Date().toISOString(),
      available: true,
      earliestArchiveDate,
      earliestYear,
      earliestMonth,
      ageInYears,
      sparklineData
    };
  }

  /**
   * Saves the normalized report to MongoDB.
   */
  async save(report: WebsiteAgeDoc): Promise<void> {
    console.log(`[WebsiteAgeEngine] Saving report to MongoDB collection ${WEBSITE_AGES_COLLECTION}...`);
    const { connectToDatabase } = await import("../database/mongo");
    const db = await connectToDatabase();
    await db.collection(WEBSITE_AGES_COLLECTION).updateOne(
      { domain: report.domain },
      { $set: report },
      { upsert: true }
    );
    console.log(`[WebsiteAgeEngine] Report saved successfully to MongoDB collection ${WEBSITE_AGES_COLLECTION}.`);
  }

  /**
   * Retrieves an existing report for the domain from MongoDB.
   */
  async get(domain: string): Promise<WebsiteAgeDoc | null> {
    const sanitizedDomain = domain.trim().toLowerCase().replace(/^www\./i, "");
    console.log(`[WebsiteAgeEngine] Retrieving report for domain: ${sanitizedDomain} from MongoDB collection ${WEBSITE_AGES_COLLECTION}...`);
    const { connectToDatabase } = await import("../database/mongo");
    const db = await connectToDatabase();
    const doc = await db.collection(WEBSITE_AGES_COLLECTION).findOne({ domain: sanitizedDomain });
    if (!doc) {
      console.log(`[WebsiteAgeEngine] Report not found for domain: ${sanitizedDomain}`);
      return null;
    }
    return {
      url: doc.url,
      domain: doc.domain,
      checkedAt: doc.checkedAt,
      available: doc.available,
      earliestArchiveDate: doc.earliestArchiveDate,
      earliestYear: doc.earliestYear,
      earliestMonth: doc.earliestMonth,
      ageInYears: doc.ageInYears,
      sparklineData: doc.sparklineData
    } as WebsiteAgeDoc;
  }
}

// CLI Direct Runner Support
const isCli = process.argv[1] && (
  process.argv[1].endsWith("websiteAge.ts") || 
  process.argv[1].endsWith("websiteAge.js")
);

if (isCli) {
  const args = process.argv.slice(2);
  const targetUrl = args[0];

  if (!targetUrl) {
    console.error("Usage: bun run src/scraper/websiteAge.ts <url>");
    process.exit(1);
  }

  (async () => {
    try {
      const engine = new WebsiteAgeEngine();
      const report = await engine.generate(targetUrl);
      await engine.save(report);
      const { closeDatabaseConnection } = await import("../database/mongo");
      await closeDatabaseConnection();
      console.log(`[WebsiteAge CLI] Successfully generated and saved report for ${targetUrl}`);
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    } catch (err) {
      console.error("[WebsiteAge CLI] Error running execution:", err);
      process.exit(1);
    }
  })();
}
