# ChatGPT Browser Automation Layer - Walkthrough

This guide explains how to install, authenticate, run, and query your internal ChatGPT API.

---

## 🚀 Setup & Installation

Since command-line package installations are restricted in the sandbox workspace, please execute the following commands in your local terminal:

```bash
# 1. Install dependencies
bun install

# 2. Install Playwright's Chromium browser
bunx playwright install chromium
```

---

## 🔑 Authentication (Interactive Login)

ChatGPT requires an active login session. We've built an interactive CLI utility to capture your credentials and persist them securely in `session.json`.

1. Run the interactive login script:
   ```bash
   bun run login
   ```
2. A headed Chromium browser window will open automatically.
3. Log in to your ChatGPT account (via Google, Apple, Email, etc.).
4. Once logged in and you see the main chat input bar, the script will automatically detect the chat interface, save your cookies & local storage to `session.json`, and close the browser.

> [!NOTE]
> The session state is saved to `session.json` which is ignored in `.gitignore` to prevent committing your login details. If your session ever expires, just re-run `bun run login`.

---

## 🏃 Running the Server

Start the API server by running:

```bash
bun run start
```

This will spin up the `Bun.serve` server on the port defined in `.env` (default is `3000`).

---

## 🔍 Standalone Google Search Scraper CLI

You can run the Google SERP scraper engine standalone directly from the command line without starting the API server:

```bash
bun run scrape "<keyword>" [startPage] [endPage]
```

* `keyword` (required): The keyword you wish to search on Google.
* `startPage` (optional, default: `1`): The starting page of results.
* `endPage` (optional, default: `startPage`): The ending page of results.

### Example CLI Scrape:
```bash
# Scrape page 1 to 3 for "reddit marketing tool"
bun run scrape "reddit marketing tool" 1 3
```

Results are saved to `data/raw/raw_<keyword>.json` with organic results and raw HTML content.

---

## ⚡ Standalone Lighthouse Audit CLI

You can perform a Lighthouse audit for any URL directly from the CLI. This requests data from the Google PageSpeed Insights API, normalizes the response, and saves it in the `reports/` folder:

```bash
bun run lighthouse "<url>"
```

### Example CLI Audit:
```bash
# Run audit and save report as reports/github.com.json
bun run lighthouse "https://github.com"
```

---

## 📡 API Endpoints

### 1. `POST /ask`
Submit a prompt to ChatGPT. The request is placed in a queue and processed sequentially.

* **URL**: `/ask`
* **Method**: `POST`
* **Body (JSON)**:
  ```json
  {
    "prompt": "Explain Quantum Computing in 3 sentences.",
    "deleteConversation": true
  }
  ```
  * `prompt` (string, required): The prompt content.
  * `deleteConversation` (boolean, optional, default: `true`): If `true`, the conversation is archived automatically after response extraction, keeping your sidebar clutter-free.

* **Response (JSON)**:
  ```json
  {
    "success": true,
    "answer": "Quantum computing is a field of computing focused on developing technology based on the principles of quantum theory...",
    "method": "network",
    "conversationId": "4892cfae-360e-4ab6-8f3e-4b67912abc01"
  }
  ```

* **Example CURL**:
  ```bash
  curl -X POST http://localhost:3000/ask \
       -H "Content-Type: application/json" \
       -d '{"prompt": "Calculate 256 * 144", "deleteConversation": true}'
  ```

---

### 2. `GET /status`
Check the health of the browser and queue size.

* **URL**: `/status`
* **Method**: `GET`
* **Response (JSON)**:
  ```json
  {
    "initialized": true,
    "hasSession": true,
    "queue": {
      "pending": 0,
      "active": 0
    }
  }
  ```

---

### 3. `POST /login`
Initiates the interactive headed login script remotely via an API call (if you are running the server and want to trigger a login).

* **URL**: `/login`
* **Method**: `POST`
* **Response (JSON)**:
  ```json
  {
    "success": true,
    "message": "Interactive headed login started in background..."
  }
  ```

---

### 4. `POST /session/reset`
Clears the saved session state, logs out, and closes the browser context.

* **URL**: `/session/reset`
* **Method**: `POST`
* **Response (JSON)**:
  ```json
  {
    "success": true,
    "message": "Session cleared successfully."
  }
  ```

---

### 5. `POST /scrape`
Triggers the standalone Google SERP scraper engine for a given keyword and page range.

* **URL**: `/scrape`
* **Method**: `POST`
* **Body (JSON)**:
  ```json
  {
    "keyword": "reddit marketing tool",
    "startPage": 1,
    "endPage": 2
  }
  ```
  * `keyword` (string, required): The search term to query.
  * `startPage` (number, optional, default: `1`): The first page to scrape (1-indexed).
  * `endPage` (number, optional, default: `startPage`): The last page to scrape.

* **Response (JSON)**:
  ```json
  {
    "success": true,
    "message": "Successfully scraped pages 1 to 2 for keyword: reddit marketing tool",
    "data": {
      "keyword": "reddit marketing tool",
      "scrapedAt": "2026-06-20T12:00:00.000Z",
      "pagesCount": 2
    }
  }
  ```

* **Example CURL**:
  ```bash
  curl -X POST http://localhost:3000/scrape \
       -H "Content-Type: application/json" \
       -d '{"keyword": "reddit marketing tool", "startPage": 1, "endPage": 2}'
  ```

---

### 6. `POST /api/lighthouse`
Generates a new Lighthouse audit report for a given website URL and overwrites the existing domain report inside `reports/domain.json`.

* **URL**: `/api/lighthouse`
* **Method**: `POST`
* **Body (JSON)**:
  ```json
  {
    "url": "https://github.com"
  }
  ```
* **Response (JSON)**:
  ```json
  {
    "success": true,
    "domain": "github.com",
    "saved": true,
    "path": "reports/github.com.json"
  }
  ```
* **Example CURL**:
  ```bash
  curl -X POST http://localhost:3000/api/lighthouse \
       -H "Content-Type: application/json" \
       -d '{"url": "https://github.com"}'
  ```

---

### 7. `GET /api/lighthouse/:domain`
Retrieves the saved Lighthouse audit report for a specific domain name.

* **URL**: `/api/lighthouse/github.com`
* **Method**: `GET`
* **Response (JSON)**:
  ```json
  {
    "domain": "github.com",
    "report": {
      // Google PageSpeed API response containing Lighthouse audits
    }
  }
  ```
* **Example CURL**:
  ```bash
  curl http://localhost:3000/api/lighthouse/github.com
  ```

---

## 🛠️ Key Architectural Highlights

* **Direct URL Injection**: Instead of opening a blank chat page and typing the prompt character-by-character (which is slower and can occasionally trigger ProseMirror sync issues), the service navigates directly to `https://chatgpt.com/?prompt=<encoded_text>`.
  * If ChatGPT auto-submits, the system immediately proceeds to monitor the streamed output.
  * If ChatGPT only pre-fills the input box, the system detects the text and immediately triggers the send action.
* **StorageState Preservation**: We save all cookies, local storage, and session variables to `session.json`, allowing the browser to boot directly into ChatGPT already authenticated.
* **Dual Extraction (Network + DOM)**:
  * **Primary (Network Interceptor)**: Captures the Server-Sent Events (SSE) data stream response from ChatGPT `/backend-api/conversation` endpoint and parses the final JSON chunk. This is extremely stable and ignores DOM changes.
  * **Secondary (DOM Scraper Fallback)**: If the API endpoint is blocked or changed, the system automatically scrapes the DOM selector `[data-message-author-role="assistant"]` as a fallback.
* **Auto-healing Tab/Browser Recovery**: If a page is closed or crashes, the server automatically boots a new browser context and retries the prompt seamlessly.
* **Custom Synchronization Queue**: Custom task queue processes requests strictly sequentially (FIFO) to prevent race conditions on the browser instance.
