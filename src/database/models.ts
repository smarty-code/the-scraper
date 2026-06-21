import { Db } from "mongodb";

// Collection Name Constants
export const CRAWLER_DATA_COLLECTION = "crawler_data";
export const REFINED_SCRAPES_COLLECTION = "refined_scrapes";
export const LIGHTHOUSE_REPORTS_COLLECTION = "lighthouse_reports";

// TypeScript Models & Interfaces

export interface ScrapedResultItem {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

export interface ScrapedPage {
  pageNumber: number;
  url: string;
  results: ScrapedResultItem[];
}

/**
 * Schema for raw crawler results stored in MongoDB (HTML excluded)
 */
export interface CrawlerDataDoc {
  keyword: string;
  scrapedAt: string;
  pages: ScrapedPage[];
}

export interface RefinedResultItem {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  confidenceScore: number;
}

/**
 * Schema for AI-refined search results stored in MongoDB
 */
export interface RefinedScrapeDoc {
  keyword: string;
  refinedAt: string;
  instructions: string;
  results: RefinedResultItem[];
}

/**
 * Schema for PageSpeed audit reports stored in MongoDB
 */
export interface LighthouseReportDoc {
  url: string;
  domain: string;
  generatedAt: string;
  report: any; // Raw Google PageSpeed Insights JSON payload
}

/**
 * Initializes the MongoDB database collections and unique indexes for fast querying.
 */
export async function initializeDatabase(db: Db): Promise<void> {
  console.log("[Database] Initializing collection indexes...");
  
  try {
    // 1. Crawler Data unique index on keyword
    await db.collection(CRAWLER_DATA_COLLECTION).createIndex(
      { keyword: 1 },
      { unique: true, name: "idx_crawler_data_keyword" }
    );
    console.log(`[Database] Index created: ${CRAWLER_DATA_COLLECTION} (keyword)`);

    // 2. Refined Scrapes unique index on keyword
    await db.collection(REFINED_SCRAPES_COLLECTION).createIndex(
      { keyword: 1 },
      { unique: true, name: "idx_refined_scrapes_keyword" }
    );
    console.log(`[Database] Index created: ${REFINED_SCRAPES_COLLECTION} (keyword)`);

    // 3. Lighthouse Reports unique index on domain
    await db.collection(LIGHTHOUSE_REPORTS_COLLECTION).createIndex(
      { domain: 1 },
      { unique: true, name: "idx_lighthouse_reports_domain" }
    );
    console.log(`[Database] Index created: ${LIGHTHOUSE_REPORTS_COLLECTION} (domain)`);

  } catch (err: any) {
    console.error("[Database] Error creating database indexes:", err);
  }
}
