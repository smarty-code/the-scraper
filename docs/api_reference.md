# 🔌 HTTP API Reference

The server exposes a set of REST endpoints to trigger scrapes, query reports, submit prompts to ChatGPT, and manage browser states.

**Base URL**: `http://localhost:3000`

---

## 🚦 Server Status

### `GET /status`
Returns the status of the browser instance, active session parameters, and queued operations.

*   **Response (200)**:
    ```json
    {
      "initialized": true,
      "hasSession": true,
      "queue": { "pending": 0, "active": 0 }
    }
    ```

---

## 📋 Data Listing & Retrieval Endpoints

These are read-only GET endpoints for retrieving stored data from MongoDB. Designed for frontend consumption.

---

### `GET /api/keywords`
Lists all keywords that have been scraped and/or refined. Returns metadata, counts, and refinement status for each keyword.

*   **Response (200)**:
    ```json
    {
      "success": true,
      "count": 2,
      "keywords": [
        {
          "keyword": "reddit marketing tool",
          "scrapedAt": "2026-06-21T18:00:00.000Z",
          "pagesScraped": 2,
          "rawResultsCount": 20,
          "hasRefinedData": true,
          "refinedAt": "2026-06-21T18:01:00.000Z",
          "refinedResultsCount": 7,
          "instructions": "Only automated tools"
        }
      ]
    }
    ```
*   **Example**:
    ```bash
    curl http://localhost:3000/api/keywords
    ```

---

### `GET /api/scrapes`
Lists all raw scrape records as summaries (keyword, timestamp, page count, result count). Does NOT include the actual result items.

*   **Response (200)**:
    ```json
    {
      "success": true,
      "count": 2,
      "scrapes": [
        {
          "keyword": "reddit marketing tool",
          "scrapedAt": "2026-06-21T18:00:00.000Z",
          "pagesScraped": 2,
          "rawResultsCount": 20
        }
      ]
    }
    ```
*   **Example**:
    ```bash
    curl http://localhost:3000/api/scrapes
    ```

---

### `GET /api/scrapes/:keyword`
Retrieves the full raw scrape data for a specific keyword, including all pages and their organic result items.

*   **URL Parameter**: `keyword` — URL-encoded search term
*   **Response (200)**:
    ```json
    {
      "keyword": "reddit marketing tool",
      "scrapedAt": "2026-06-21T18:00:00.000Z",
      "pagesScraped": 1,
      "rawResultsCount": 10,
      "pages": [
        {
          "pageNumber": 1,
          "url": "https://www.google.com/search?q=reddit+marketing+tool&start=0",
          "results": [
            {
              "position": 1,
              "title": "Howitzer - First Reddit Marketing Tool",
              "url": "https://howitzer.co",
              "snippet": "Automate your Reddit marketing..."
            }
          ]
        }
      ]
    }
    ```
*   **Response (404)**: `{ "success": false, "error": "Raw scrape data not found for keyword: ..." }`
*   **Example**:
    ```bash
    curl http://localhost:3000/api/scrapes/reddit%20marketing%20tool
    ```

---

### `GET /api/refined/:keyword`
Retrieves stored AI-refined search results for a specific keyword.

*   **URL Parameter**: `keyword` — URL-encoded search term
*   **Response (200)**:
    ```json
    {
      "keyword": "reddit marketing tool",
      "refinedAt": "2026-06-21T18:01:00.000Z",
      "instructions": "Only automated tools",
      "results": [
        {
          "rank": 1,
          "title": "Howitzer - First Reddit Marketing Tool",
          "url": "https://howitzer.co",
          "snippet": "SaaS for Reddit marketing automations.",
          "confidenceScore": 0.98
        }
      ]
    }
    ```
*   **Response (404)**: `{ "success": false, "error": "Refined scraper results not found for keyword: ..." }`
*   **Example**:
    ```bash
    curl http://localhost:3000/api/refined/reddit%20marketing%20tool
    ```

---

### `GET /api/lighthouse`
Lists all audited domains with their latest Lighthouse scores (performance, accessibility, best-practices, seo). Scores are normalized 0.0–1.0.

*   **Response (200)**:
    ```json
    {
      "success": true,
      "count": 1,
      "reports": [
        {
          "domain": "github.com",
          "url": "https://github.com",
          "generatedAt": "2026-06-21T18:30:00.000Z",
          "scores": {
            "performance": 0.92,
            "accessibility": 0.95,
            "bestPractices": 1.0,
            "seo": 0.90
          }
        }
      ]
    }
    ```
*   **Example**:
    ```bash
    curl http://localhost:3000/api/lighthouse
    ```

---

### `GET /api/lighthouse/:domain`
Retrieves the full Lighthouse audit report for a specific domain.

*   **URL Parameter**: `domain` — domain name without protocol (e.g. `github.com`)
*   **Response (200)**:
    ```json
    {
      "domain": "github.com",
      "url": "https://github.com",
      "generatedAt": "2026-06-21T18:30:00.000Z",
      "report": { "lighthouseResult": { "categories": { "...": "..." } } }
    }
    ```
*   **Response (404)**: `{ "success": false, "error": "Lighthouse report not found for domain: ..." }`
*   **Example**:
    ```bash
    curl http://localhost:3000/api/lighthouse/github.com
    ```

---

## 🔍 Scraping & Refinement (Write)

### `POST /scrape`
Triggers the full pipeline: Google SERP scrape → save raw to `crawler_data` → send to ChatGPT for AI ranking → filter by confidence ≥ 0.5 → save to `refined_scrapes` → return refined results.

*   **Body (JSON)**:
    ```json
    {
      "keyword": "reddit marketing tool",
      "startPage": 1,
      "endPage": 1,
      "instructions": "Only include SaaS tools. Exclude articles."
    }
    ```
    | Field | Type | Required | Default | Description |
    |-------|------|----------|---------|-------------|
    | `keyword` | string | ✅ | — | Search term |
    | `startPage` | number | ❌ | `1` | First SERP page |
    | `endPage` | number | ❌ | `startPage` | Last SERP page |
    | `instructions` | string | ❌ | `""` | Custom AI filtering guidelines |

*   **Response (200)**:
    ```json
    {
      "success": true,
      "keyword": "reddit marketing tool",
      "pagesScraped": 1,
      "rawResultsCount": 10,
      "refinedResultsCount": 4,
      "refinedResults": [
        {
          "rank": 1,
          "title": "Howitzer",
          "url": "https://howitzer.co",
          "snippet": "...",
          "confidenceScore": 0.98
        }
      ]
    }
    ```
*   **Example**:
    ```bash
    curl -X POST http://localhost:3000/scrape \
      -H "Content-Type: application/json" \
      -d '{"keyword": "reddit marketing tool", "startPage": 1, "instructions": "Only tools"}'
    ```

---

## ⚡ Lighthouse Audits (Write)

### `POST /api/lighthouse`
Generates a PageSpeed audit for a URL and saves it to MongoDB. Does NOT use the browser queue.

*   **Body (JSON)**:
    ```json
    { "url": "https://github.com" }
    ```
*   **Response (200)**:
    ```json
    { "success": true, "domain": "github.com", "saved": true, "path": "MongoDB collection: lighthouse_reports" }
    ```
*   **Example**:
    ```bash
    curl -X POST http://localhost:3000/api/lighthouse \
      -H "Content-Type: application/json" \
      -d '{"url": "https://github.com"}'
    ```

---

## 🤖 ChatGPT Prompts

### `POST /ask`
Submits a raw prompt to ChatGPT and returns the response.

*   **Body (JSON)**:
    ```json
    { "prompt": "Explain quantum computing in 2 sentences.", "deleteConversation": true }
    ```
*   **Response (200)**:
    ```json
    { "success": true, "answer": "...", "method": "network", "conversationId": "..." }
    ```

---

## 🔐 Session Management

### `POST /login`
Opens a headed Chromium for manual ChatGPT login.

### `POST /session/reset`
Clears saved cookies and closes the browser context.
