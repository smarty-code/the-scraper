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

## 🛡️ Stateful Scrape & Refinement Jobs

These endpoints support stateful progress tracking, check-pointing, batching (by 10 items), and recovery/retry capabilities for the scraping and AI refinement process.

### `POST /api/scrapes/jobs`
Creates a new stateful job record in MongoDB, queues it for execution in the background queue, and returns the Job ID immediately.

*   **Body (JSON)**:
    ```json
    {
      "keyword": "reddit marketing tool",
      "startPage": 1,
      "endPage": 2,
      "instructions": "Only include SaaS tools"
    }
    ```
*   **Response (202 Accepted)**:
    ```json
    {
      "success": true,
      "jobId": "87b1c360-14e9-4e78-9571-b0db0ab5432a",
      "status": "pending",
      "message": "Scrape job created and queued successfully."
    }
    ```

---

### `GET /api/scrapes/jobs`
Lists all scrape jobs stored in the database sorted by creation timestamp (newest first).

*   **Response (200 OK)**:
    ```json
    {
      "success": true,
      "jobs": [
        {
          "jobId": "87b1c360-14e9-4e78-9571-b0db0ab5432a",
          "keyword": "reddit marketing tool",
          "status": "completed",
          "createdAt": "2026-06-22T08:00:00.000Z"
        }
      ]
    }
    ```

---

### `GET /api/scrapes/jobs/:jobId`
Retrieves detailed, real-time status and batch progress of a specific job.

*   **Response (200 OK)**:
    ```json
    {
      "success": true,
      "job": {
        "jobId": "87b1c360-14e9-4e78-9571-b0db0ab5432a",
        "keyword": "reddit marketing tool",
        "status": "partial_failed",
        "scraping": {
          "status": "completed",
          "completedPagesCount": 2,
          "totalPagesCount": 2,
          "pages": [
            { "pageNumber": 1, "status": "completed", "url": "..." },
            { "pageNumber": 2, "status": "completed", "url": "..." }
          ]
        },
        "refinement": {
          "status": "partial_failed",
          "totalBatches": 2,
          "completedBatches": 1,
          "failedBatches": 1,
          "batches": [
            {
              "batchIndex": 0,
              "status": "completed",
              "attempts": 1,
              "rawItemsCount": 10,
              "startIndex": 0,
              "endIndex": 9
            },
            {
              "batchIndex": 1,
              "status": "failed",
              "attempts": 1,
              "error": "Timeout waiting for ChatGPT response",
              "rawItemsCount": 8,
              "startIndex": 10,
              "endIndex": 17
            }
          ]
        }
      }
    }
    ```

---

### `POST /api/scrapes/jobs/:jobId/retry`
Queues a retry request for all failed elements of a job (or a specific failed batch).

*   **Body (JSON - Optional)**:
    ```json
    {
      "batchIndex": 1
    }
    ```
    If `batchIndex` is omitted, the engine will retry all failed components (both failed scraping pages and failed refinement batches).
*   **Response (202 Accepted)**:
    ```json
    {
      "success": true,
      "jobId": "87b1c360-14e9-4e78-9571-b0db0ab5432a",
      "message": "Retry queued for batch index 1."
    }
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

### `POST /session/cookies`
Directly updates/imports the session cookies in MongoDB using a JSON list of cookies (Chrome extension format). This is useful for migrating cookie storage to MongoDB and automating session setups in cloud environments.

*   **Body (JSON)**:
    ```json
    [
      {
        "domain": ".chatgpt.com",
        "expirationDate": 1782725674.446028,
        "hostOnly": false,
        "httpOnly": false,
        "name": "_puid",
        "path": "/",
        "sameSite": "lax",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "user-fOm7QLiPySyN2k8OF6YwhQDH:..."
      }
    ]
    ```
*   **Response (200)**:
    ```json
    {
      "success": true,
      "message": "Cookies updated in MongoDB successfully and active session reloaded."
    }
    ```
*   **Example**:
    ```bash
    curl -X POST http://localhost:3000/session/cookies \
      -H "Content-Type: application/json" \
      -d '[{"name": "_puid", "value": "...", "domain": ".chatgpt.com", "path": "/"}]'
    ```
