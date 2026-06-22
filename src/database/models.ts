import { Db } from "mongodb";

// Collection Name Constants
export const CRAWLER_DATA_COLLECTION = "crawler_data";
export const REFINED_SCRAPES_COLLECTION = "refined_scrapes";
export const LIGHTHOUSE_REPORTS_COLLECTION = "lighthouse_reports";
export const SCRAPE_JOBS_COLLECTION = "scrape_jobs";
export const BROWSER_SESSIONS_COLLECTION = "browser_sessions";


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
  id: string;
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

// Scrape & Refinement Jobs State Tracking Interfaces

export interface JobPageStatus {
  pageNumber: number;
  status: "pending" | "completed" | "failed";
  url: string;
  error?: string | null;
}

export interface JobRefinementBatch {
  batchIndex: number;          // 0-based index
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;            // Counter for tracking retries
  error?: string | null;
  startIndex: number;          // Index of first raw item in this batch
  endIndex: number;            // Index of last raw item in this batch
  rawItemsCount: number;
  refinedItems?: RefinedResultItem[]; // Staged refined results for this batch
}

export interface ScrapeJobDoc {
  jobId: string;               // Unique UUID/Nanoid
  keyword: string;
  startPage: number;
  endPage: number;
  instructions: string;
  status: "pending" | "scraping" | "refining" | "completed" | "failed" | "partial_failed";
  error?: string | null;
  createdAt: string;           // ISO string
  updatedAt: string;           // ISO string
  
  // Stage 1: Google Scrape progress
  scraping: {
    status: "pending" | "running" | "completed" | "failed";
    error?: string | null;
    completedPagesCount: number;
    totalPagesCount: number;
    pages: JobPageStatus[];
  };

  // Stage 2: AI Refinement progress (in batches of 10)
  refinement: {
    status: "pending" | "running" | "completed" | "failed" | "partial_failed";
    error?: string | null;
    totalBatches: number;
    completedBatches: number;
    failedBatches: number;
    batches: JobRefinementBatch[];
  };
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

    // 4. Scrape Jobs unique index on jobId
    await db.collection(SCRAPE_JOBS_COLLECTION).createIndex(
      { jobId: 1 },
      { unique: true, name: "idx_scrape_jobs_jobId" }
    );
    console.log(`[Database] Index created: ${SCRAPE_JOBS_COLLECTION} (jobId)`);

    // 5. Browser Sessions unique index on sessionId
    await db.collection(BROWSER_SESSIONS_COLLECTION).createIndex(
      { sessionId: 1 },
      { unique: true, name: "idx_browser_sessions_sessionId" }
    );
    console.log(`[Database] Index created: ${BROWSER_SESSIONS_COLLECTION} (sessionId)`);

  } catch (err: any) {
    console.error("[Database] Error creating database indexes:", err);
  }
}
