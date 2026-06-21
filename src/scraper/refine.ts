import { ConversationManager } from "../chatgpt/conversation";
import { connectToDatabase } from "../database/mongo";
import { 
  REFINED_SCRAPES_COLLECTION, 
  RefinedResultItem as RefinedResult, 
  RefinedScrapeDoc as RefinedScrapePayload 
} from "../database/models";

/**
 * Cleans and parses a JSON response from ChatGPT, even if wrapped in Markdown code blocks.
 */
function cleanAndParseJSON(text: string): any {
  let cleaned = text.trim();
  
  // Strip Markdown codeblock markers if present
  cleaned = cleaned.replace(/^```json\s*/i, "");
  cleaned = cleaned.replace(/^```\s*/, "");
  cleaned = cleaned.replace(/\s*```$/, "");
  cleaned = cleaned.trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Find first '{' or '[' and last '}' or ']'
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  throw new Error("Could not extract valid JSON from ChatGPT response");
}

/**
 * Orchestrates sending search results to ChatGPT for filtering and ranking.
 * Returns only results with confidence score >= 0.5.
 */
export async function refineResults(
  conversationManager: ConversationManager,
  keyword: string,
  results: Array<{ title: string; url: string; snippet: string }>,
  userInstructions?: string
): Promise<RefinedResult[]> {
  console.log(`[Refinement] Starting AI refinement for keyword: "${keyword}"`);
  
  if (results.length === 0) {
    console.log("[Refinement] No search results to refine.");
    return [];
  }

  // Format list of links to feed into ChatGPT
  const resultsListString = results.map((r, i) => {
    return `${i + 1}. Title: "${r.title}"\n   URL: ${r.url}\n   Snippet: "${r.snippet || "N/A"}"`;
  }).join("\n\n");

  const instructionsText = userInstructions && userInstructions.trim().length > 0
    ? `User guidelines/instructions for refinement:\n${userInstructions}`
    : "Identify the most relevant organic search results, filtering out irrelevant listings, registers, directories, or spam.";

  const prompt = `You are a search result quality refinement and ranking AI.
Analyze the following Google search results and rank them based on relevance and quality for the keyword: "${keyword}".

${instructionsText}

For each result:
1. Provide a confidence score between 0.0 and 1.0 (where 1.0 is extremely confident/100% match, and 0.0 is no relevance/quality).
2. Filter out irrelevant pages or low-quality registry/directory sites.
3. Sort the final list by quality/relevance, assigning a sequential 1-based rank (1 is the best).

You must return your response strictly as a JSON object in the exact format shown below. Do not include any explanation, introduction, conclusion, markdown decorations, or text outside of the JSON object.

Expected JSON format:
{
  "results": [
    {
      "rank": 1,
      "title": "Title of the website",
      "url": "https://example.com/url",
      "snippet": "Brief summary snippet",
      "confidenceScore": 0.95
    }
  ]
}

Here are the search results to refine:
${resultsListString}`;

  console.log(`[Refinement] Submitting refinement prompt to ChatGPT (results count: ${results.length})...`);
  const askResult = await conversationManager.ask(prompt, true);

  if (!askResult.success || !askResult.answer) {
    throw new Error(`Failed to get response from ChatGPT: ${askResult.error || "Unknown error"}`);
  }

  console.log("[Refinement] Parsing ChatGPT response...");
  const parsed = cleanAndParseJSON(askResult.answer);

  let refinedArray: any[] = [];
  if (parsed && Array.isArray(parsed.results)) {
    refinedArray = parsed.results;
  } else if (Array.isArray(parsed)) {
    refinedArray = parsed;
  } else {
    throw new Error("Parsed JSON structure does not contain a list of results");
  }

  // Normalize, filter, and cast to RefinedResult
  const filtered = refinedArray
    .map((item: any, index: number) => {
      const confidence = typeof item.confidenceScore === "number" 
        ? item.confidenceScore 
        : parseFloat(String(item.confidenceScore)) || 0.0;
      return {
        rank: item.rank || index + 1,
        title: item.title || "",
        url: item.url || "",
        snippet: item.snippet || "",
        confidenceScore: confidence
      };
    })
    .filter(item => item.confidenceScore >= 0.5); // Drop anything below 0.5 (50%)

  console.log(`[Refinement] Filtered refined results: ${filtered.length} out of ${refinedArray.length} met confidence score threshold of >= 0.5.`);
  return filtered;
}

/**
 * Saves the refined scraper results into the 'refined_scrapes' collection in MongoDB.
 */
export async function saveRefinedScrape(
  keyword: string,
  instructions: string,
  results: RefinedResult[]
): Promise<void> {
  const db = await connectToDatabase();
  const payload: RefinedScrapePayload = {
    keyword,
    refinedAt: new Date().toISOString(),
    instructions,
    results
  };

  console.log(`[Database] Saving refined scrapes for keyword "${keyword}" to ${REFINED_SCRAPES_COLLECTION}...`);
  await db.collection(REFINED_SCRAPES_COLLECTION).updateOne(
    { keyword },
    { $set: payload },
    { upsert: true }
  );
  console.log(`[Database] Refined scrapes saved successfully to ${REFINED_SCRAPES_COLLECTION}.`);
}
