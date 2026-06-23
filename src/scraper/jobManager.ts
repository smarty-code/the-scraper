import "../polyfill";
import { connectToDatabase } from "../database/mongo";
import { 
  SCRAPE_JOBS_COLLECTION,
  CRAWLER_DATA_COLLECTION,
  REFINED_SCRAPES_COLLECTION,
  ScrapeJobDoc,
  JobPageStatus,
  JobRefinementBatch,
  RefinedResultItem
} from "../database/models";
import { scrapeGooglePage } from "./google";
import { refineResults, saveRefinedScrape } from "./refine";
import { BrowserManager } from "../browser/browser";

/**
 * Creates a unique job ID.
 */
export function generateJobId(): string {
  return crypto.randomUUID();
}

/**
 * Creates a new stateful job in MongoDB and prepares page and batch placeholders.
 */
export async function createJob(
  keyword: string,
  startPage: number,
  endPage: number,
  instructions: string
): Promise<ScrapeJobDoc> {
  const db = await connectToDatabase();
  const jobId = generateJobId();

  const totalPages = endPage - startPage + 1;
  const pages: JobPageStatus[] = [];
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const start = (pageNum - 1) * 10;
    pages.push({
      pageNumber: pageNum,
      status: "pending",
      url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}&start=${start}`
    });
  }

  const job: ScrapeJobDoc = {
    jobId,
    keyword,
    startPage,
    endPage,
    instructions,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scraping: {
      status: "pending",
      completedPagesCount: 0,
      totalPagesCount: totalPages,
      pages
    },
    refinement: {
      status: "pending",
      totalBatches: 0,
      completedBatches: 0,
      failedBatches: 0,
      batches: []
    }
  };

  await db.collection(SCRAPE_JOBS_COLLECTION).insertOne(job);
  console.log(`[JobManager] Job ${jobId} created in MongoDB.`);
  return job;
}

import { AIProvider } from "../ai/provider";

/**
 * Executes a job end-to-end, updating states incrementally.
 */
export async function executeJob(jobId: string, getAIProvider: () => Promise<AIProvider>): Promise<void> {
  const db = await connectToDatabase();
  console.log(`[JobManager] Executing job ${jobId}...`);

  // Fetch job
  const job = (await db.collection(SCRAPE_JOBS_COLLECTION).findOne({ jobId })) as ScrapeJobDoc | null;
  if (!job) {
    console.error(`[JobManager] Job ${jobId} not found in database.`);
    return;
  }

  try {
    // -------------------------------------------------------------
    // STAGE 1: GOOGLE SCRAPING
    // -------------------------------------------------------------
    if (job.scraping.status !== "completed") {
      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId },
        { 
          $set: { 
            status: "scraping",
            "scraping.status": "running",
            updatedAt: new Date().toISOString()
          } 
        }
      );

      const browserManager = BrowserManager.getInstance();
      const page = await browserManager.getPage();
      
      const pagesData: any[] = [];
      let anyPageFailed = false;

      for (let i = 0; i < job.scraping.pages.length; i++) {
        const pageSpec = job.scraping.pages[i];
        if (pageSpec.status === "completed") {
          // If already completed in a previous attempt, skip scraping
          const existingCrawlerData = await db.collection(CRAWLER_DATA_COLLECTION).findOne({ keyword: job.keyword });
          const existingPage = existingCrawlerData?.pages?.find((p: any) => p.pageNumber === pageSpec.pageNumber);
          if (existingPage) {
            pagesData.push(existingPage);
            continue;
          }
        }

        console.log(`[JobManager] Scraping page ${pageSpec.pageNumber} for Job ${jobId}...`);
        
        try {
          const scraped = await scrapeGooglePage(page, job.keyword, pageSpec.pageNumber);
          const pageRecord = {
            pageNumber: scraped.pageNumber,
            url: scraped.url,
            results: scraped.results
          };
          pagesData.push(pageRecord);

          // Update page status in array
          await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
            { jobId, "scraping.pages.pageNumber": pageSpec.pageNumber },
            { 
              $set: { 
                "scraping.pages.$.status": "completed",
                "scraping.pages.$.error": null,
                updatedAt: new Date().toISOString()
              },
              $inc: { "scraping.completedPagesCount": 1 }
            }
          );
        } catch (err: any) {
          console.error(`[JobManager] Page ${pageSpec.pageNumber} failed:`, err);
          anyPageFailed = true;
          await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
            { jobId, "scraping.pages.pageNumber": pageSpec.pageNumber },
            { 
              $set: { 
                "scraping.pages.$.status": "failed",
                "scraping.pages.$.error": err.message || String(err),
                updatedAt: new Date().toISOString()
              } 
            }
          );
        }
      }

      // Save raw data to crawler_data
      if (pagesData.length > 0) {
        // Fetch existing or initialize
        const existingData = await db.collection(CRAWLER_DATA_COLLECTION).findOne({ keyword: job.keyword });
        let consolidatedPages = existingData?.pages || [];

        for (const newPage of pagesData) {
          const idx = consolidatedPages.findIndex((p: any) => p.pageNumber === newPage.pageNumber);
          if (idx !== -1) {
            consolidatedPages[idx] = newPage;
          } else {
            consolidatedPages.push(newPage);
          }
        }

        // Sort consolidated pages by pageNumber
        consolidatedPages.sort((a: any, b: any) => a.pageNumber - b.pageNumber);

        const dbPayload = {
          keyword: job.keyword,
          scrapedAt: new Date().toISOString(),
          pages: consolidatedPages
        };

        await db.collection(CRAWLER_DATA_COLLECTION).updateOne(
          { keyword: job.keyword },
          { $set: dbPayload },
          { upsert: true }
        );
        console.log(`[JobManager] Saved consolidated crawler data to MongoDB.`);
      }

      // Let's query the updated database document to see the current state
      const freshJob = (await db.collection(SCRAPE_JOBS_COLLECTION).findOne({ jobId })) as ScrapeJobDoc;
      const completedPagesCount = freshJob.scraping.pages.filter(p => p.status === "completed").length;

      if (completedPagesCount === freshJob.scraping.totalPagesCount) {
        await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
          { jobId },
          { 
            $set: { 
              "scraping.status": "completed",
              "scraping.error": null,
              updatedAt: new Date().toISOString()
            } 
          }
        );
      } else {
        await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
          { jobId },
          { 
            $set: { 
              status: "failed",
              "scraping.status": "failed",
              "scraping.error": "Some Google search pages failed to scrape.",
              updatedAt: new Date().toISOString()
            } 
          }
        );
        return; // Terminate early if scraping has failed pages
      }
    }

    // -------------------------------------------------------------
    // STAGE 2: AI REFINEMENT
    // -------------------------------------------------------------
    // Re-load the job to get latest scraper state
    const currentJob = (await db.collection(SCRAPE_JOBS_COLLECTION).findOne({ jobId })) as ScrapeJobDoc | null;
    if (!currentJob) return;

    // Load raw scraper results from crawler_data
    const crawlerDoc = await db.collection(CRAWLER_DATA_COLLECTION).findOne({ keyword: currentJob.keyword });
    if (!crawlerDoc || !Array.isArray(crawlerDoc.pages)) {
      throw new Error(`Raw scraped data not found for keyword: ${currentJob.keyword}`);
    }

    const allRawItems: any[] = [];
    for (const page of crawlerDoc.pages) {
      if (Array.isArray(page.results)) {
        allRawItems.push(...page.results);
      }
    }

    if (allRawItems.length === 0) {
      console.log("[JobManager] No raw items found to refine.");
      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId },
        { 
          $set: { 
            status: "completed",
            "refinement.status": "completed",
            updatedAt: new Date().toISOString()
          } 
        }
      );
      return;
    }

    // Partition into batches of 10
    const batchSize = 10;
    const totalBatchesCount = Math.ceil(allRawItems.length / batchSize);

    // Initialize batches in the job document if not already done
    if (currentJob.refinement.batches.length === 0) {
      const batches: JobRefinementBatch[] = [];
      for (let b = 0; b < totalBatchesCount; b++) {
        const startIdx = b * batchSize;
        const endIdx = Math.min(startIdx + batchSize - 1, allRawItems.length - 1);
        batches.push({
          batchIndex: b,
          status: "pending",
          attempts: 0,
          startIndex: startIdx,
          endIndex: endIdx,
          rawItemsCount: endIdx - startIdx + 1,
          refinedItems: []
        });
      }

      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId },
        {
          $set: {
            "refinement.status": "running",
            "refinement.totalBatches": totalBatchesCount,
            "refinement.batches": batches,
            updatedAt: new Date().toISOString()
          }
        }
      );
    }

    await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
      { jobId },
      { 
        $set: { 
          status: "refining",
          "refinement.status": "running",
          updatedAt: new Date().toISOString()
        } 
      }
    );

    const chatManager = await getAIProvider();
    let hasAnyFailedBatch = false;

    // Process batches sequentially
    for (let b = 0; b < totalBatchesCount; b++) {
      // Re-fetch batch status
      const jobState = (await db.collection(SCRAPE_JOBS_COLLECTION).findOne({ jobId })) as ScrapeJobDoc;
      const batchSpec = jobState.refinement.batches[b];

      if (batchSpec.status === "completed") {
        continue; // Already processed
      }

      console.log(`[JobManager] Refining Batch ${b + 1} of ${totalBatchesCount} (Job ${jobId})...`);

      // Mark batch running
      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId, "refinement.batches.batchIndex": b },
        { 
          $set: { 
            "refinement.batches.$.status": "running",
            updatedAt: new Date().toISOString()
          },
          $inc: { "refinement.batches.$.attempts": 1 }
        }
      );

      const batchItems = allRawItems.slice(batchSpec.startIndex, batchSpec.endIndex + 1);

      try {
        const refinedItems = await refineResults(chatManager, job.keyword, batchItems, job.instructions);

        // Update batch status to completed and store refined items in the batch
        await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
          { jobId, "refinement.batches.batchIndex": b },
          { 
            $set: { 
              "refinement.batches.$.status": "completed",
              "refinement.batches.$.error": null,
              "refinement.batches.$.refinedItems": refinedItems,
              updatedAt: new Date().toISOString()
            },
            $inc: { "refinement.completedBatches": 1 }
          }
        );

        // Globally compile, re-rank, and save all currently refined results
        await compileAndSaveRefinedResults(jobId);

      } catch (err: any) {
        console.error(`[JobManager] Refinement failed for batch ${b}:`, err);
        hasAnyFailedBatch = true;
        
        await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
          { jobId, "refinement.batches.batchIndex": b },
          { 
            $set: { 
              "refinement.batches.$.status": "failed",
              "refinement.batches.$.error": err.message || String(err),
              updatedAt: new Date().toISOString()
            },
            $inc: { "refinement.failedBatches": 1 }
          }
        );
      }
    }

    // Set overall job status based on batch success
    const finalJobState = (await db.collection(SCRAPE_JOBS_COLLECTION).findOne({ jobId })) as ScrapeJobDoc;
    const completedBatchesCount = finalJobState.refinement.batches.filter(b => b.status === "completed").length;
    const failedBatchesCount = finalJobState.refinement.batches.filter(b => b.status === "failed").length;

    if (completedBatchesCount === finalJobState.refinement.totalBatches) {
      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId },
        { 
          $set: { 
            status: "completed",
            "refinement.status": "completed",
            "refinement.error": null,
            updatedAt: new Date().toISOString()
          } 
        }
      );
      console.log(`[JobManager] Job ${jobId} completed successfully!`);
    } else {
      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId },
        { 
          $set: { 
            status: "partial_failed",
            "refinement.status": "partial_failed",
            "refinement.error": `${failedBatchesCount} batches failed during refinement.`,
            updatedAt: new Date().toISOString()
          } 
        }
      );
      console.log(`[JobManager] Job ${jobId} ended with partial failures.`);
    }

  } catch (err: any) {
    console.error(`[JobManager] Severe error executing Job ${jobId}:`, err);
    await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
      { jobId },
      { 
        $set: { 
          status: "failed",
          error: err.message || String(err),
          updatedAt: new Date().toISOString()
        } 
      }
    );
  }
}

/**
 * Retries failed parts of an existing job (scraping pages or refinement batches).
 */
export async function retryJob(
  jobId: string,
  getAIProvider: () => Promise<AIProvider>,
  specificBatchIndex?: number
): Promise<void> {
  const db = await connectToDatabase();
  const job = (await db.collection(SCRAPE_JOBS_COLLECTION).findOne({ jobId })) as ScrapeJobDoc | null;
  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }

  console.log(`[JobManager] Queueing retry for Job ${jobId}...`);

  // Reset statuses of failed parts back to pending/running
  if (job.status === "failed" && job.scraping.status === "failed") {
    // Retry scraping: reset failed pages
    await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
      { jobId },
      {
        $set: {
          status: "pending",
          "scraping.status": "pending",
          "scraping.error": null,
          error: null,
          updatedAt: new Date().toISOString()
        }
      }
    );
    // Reset individual failed pages
    await db.collection(SCRAPE_JOBS_COLLECTION).updateMany(
      { jobId, "scraping.pages.status": "failed" },
      { 
        $set: { 
          "scraping.pages.$[elem].status": "pending",
          "scraping.pages.$[elem].error": null 
        } 
      },
      { arrayFilters: [{ "elem.status": "failed" }] }
    );
  } else if (job.status === "partial_failed" || job.refinement.status === "partial_failed") {
    // Retry refinement: reset failed/pending batches
    await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
      { jobId },
      {
        $set: {
          status: "refining",
          "refinement.status": "running",
          "refinement.error": null,
          error: null,
          updatedAt: new Date().toISOString()
        }
      }
    );

    if (specificBatchIndex !== undefined) {
      // Retry one specific batch
      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId, "refinement.batches.batchIndex": specificBatchIndex },
        { 
          $set: { 
            "refinement.batches.$.status": "pending",
            "refinement.batches.$.error": null,
            updatedAt: new Date().toISOString()
          },
          $inc: { "refinement.failedBatches": -1 }
        }
      );
    } else {
      // Retry all failed batches
      await db.collection(SCRAPE_JOBS_COLLECTION).updateMany(
        { jobId, "refinement.batches.status": "failed" },
        { 
          $set: { 
            "refinement.batches.$[elem].status": "pending",
            "refinement.batches.$[elem].error": null
          } 
        },
        { arrayFilters: [{ "elem.status": "failed" }] }
      );
      // Reset failed count
      await db.collection(SCRAPE_JOBS_COLLECTION).updateOne(
        { jobId },
        { 
          $set: { 
            "refinement.failedBatches": 0,
            updatedAt: new Date().toISOString()
          } 
        }
      );
    }
  }

  // Enqueue execution
  // We trigger it asynchronously
  executeJob(jobId, getAIProvider);
}

/**
 * Compiles all currently refined batch results, globally sorts and ranks them, and updates refined_scrapes.
 */
async function compileAndSaveRefinedResults(jobId: string): Promise<void> {
  const db = await connectToDatabase();
  const job = (await db.collection(SCRAPE_JOBS_COLLECTION).findOne({ jobId })) as ScrapeJobDoc | null;
  if (!job) return;

  const allRefinedResults: RefinedResultItem[] = [];
  for (const batch of job.refinement.batches) {
    if (batch.status === "completed" && Array.isArray(batch.refinedItems)) {
      allRefinedResults.push(...batch.refinedItems);
    }
  }

  // Globally sort by confidence score descending
  allRefinedResults.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Assign sequential rank 1..N
  const rankedResults = allRefinedResults.map((item, index) => ({
    id: item.id || crypto.randomUUID(),
    rank: index + 1,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    confidenceScore: item.confidenceScore
  }));

  // Save/Upsert to refined_scrapes collection
  await saveRefinedScrape(job.keyword, job.instructions, rankedResults);
  console.log(`[JobManager] Compiled and saved ${rankedResults.length} refined results to refined_scrapes.`);
}
