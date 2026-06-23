# ⚙️ Engine Reference

This document covers the architectural internals of the core modules driving the platform.

---

## 🌐 1. Persistent Browser Manager (`src/browser/browser.ts`)

The application starts and maintains a single browser instance at all times to avoid the resource overhead of opening and closing Chromium for each request.

*   **Cookie Syncing & Translation**: Translates cookies exported by standard Chrome Extensions (which typically format `expirationDate` as UNIX seconds and supply boolean attributes) into Playwright's specific cookie parameters (`expires` in float seconds, explicit `sameSite` strings).
*   **Context Isolation**: Uses a persistent context saved to `session.json`. If this state file exists on boot, the browser opens initialized with active cookie sessions.
*   **Hot-Reloading**: Uses a file-watch listener on the root `cookies.json`. Saving new cookies to this file triggers an instant injection of new cookies into the running browser context at runtime (`context.addCookies()`), preventing session outages.
*   **Debounced Auto-Save**: Incepts all outgoing traffic to save new `Set-Cookie` updates back into `session.json` to extend cookie lifespans.

---

## 🔍 2. Standalone Google Scraper (`src/scraper/google.ts`)

Searches and scrapes Google organic listings for keywords across several pages.

*   **Query Offsets**: Translates pages to offsets using the formula:
    $$\text{start} = (N - 1) \times 10$$
*   **Anti-Bot Protocols**:
    *   Injects realistic delays (`500ms` - `2000ms`) between page loads.
    *   Hides webdriver flags so Google does not detect automation.
*   **Organic Fallback Selectors**: Google constantly modifies search result DOM elements. The scraper parses with multiple backup selectors:
    *   Primary: `div.g` (standard organic blocks)
    *   Secondaries: Headers (`h3`), parent link anchors (`a[href]`), and snippet summaries (`div[style*="-webkit-line-clamp"]` or `.VwiC3b`).
*   **MongoDB Schema (`crawler_data`)**: Stores raw pages (url, position, title, snippet) without saving the heavy raw page `html` strings to minimize database storage size.

---

## 🤖 3. AI Refinement & Scorer Pipeline (`src/scraper/refine.ts`)

Takes raw organic results scraped from Google and processes them through ChatGPT.

*   **URL Injector**: Navigates to ChatGPT with pre-encoded prompt queries via parameters:
    `https://chatgpt.com/?prompt=<encoded_text>`
*   **Network Interception**: Intercepts Server-Sent Events (SSE) stream lines from ChatGPT's `f/conversation` API POST endpoint, parsing JSON fragments to extract the final compiled response string. DOM extraction acts as a fallback.
*   **Quality Classification Prompt**: Instructs ChatGPT to examine each website's title and snippet for relevance against the search keyword and custom guidelines, returning a structured JSON format containing a quality rank and confidence score ($[0.0, 1.0]$).
*   **High-Pass Filtration**: Filters results at runtime. Only results where:
    $$\text{confidenceScore} \ge 0.5$$
    are saved. All other pages are discarded.
*   **Archiving Threads**: Sends a silent HTTP `PATCH` payload directly from the page context to hide/archive the thread, preventing sidebar clutter.
*   **MongoDB Schema (`refined_scrapes`)**: Saves the array of sorted, quality-filtered results indexed by the keyword.

---

## ⚡ 4. Lighthouse Audit Engine (`src/scraper/lighthouse.ts`)

Audits website domains for speed, SEO, accessibility, and best practices.

*   **PageSpeed Integration**: Interacts directly with the official Google PageSpeed Insights API, avoiding the heavy memory overhead of running headless Lighthouse audits locally.
*   **Bypassing the Browser Queue**: Because the PageSpeed tool runs via external HTTP fetches rather than active local browser instances, Lighthouse audits bypass the task queue. This allows audits to run in parallel without blocking active scraper tasks.
*   **Domain Normalization**: Strips subdomains like `www.` and protocols to map reports uniformly under domain names (e.g. `github.com`).
*   **MongoDB Schema (`lighthouse_reports`)**: Saves normalized audit parameters and the API JSON response, overwriting older reports to keep only the current audit state of a domain.

---

## 🧵 5. FIFO Task Queue (`src/queue/worker.ts`)

Browser automation tasks (e.g. searching Google, querying ChatGPT) are single-threaded processes. Overlapping pages inside Chromium can lead to context crashes and login session conflicts.

*   **Single Concurrency**: Implements a simple FIFO (First In, First Out) queue with a concurrency limit of `1`.
*   **Async Processing**: Wraps requests in promises. The calling route enqueues a job, waits for its resolution block, and returns the response once the queue worker completes the task.
*   **Error Boundaries**: Guarantees that if a task fails or times out, the queue worker automatically resolves/rejects, logs the stack trace, and moves directly to the next pending item.

---

## ⏳ 6. Website Age Audit Engine (`src/scraper/websiteAge.ts`)

Audits the age of website domains by querying Wayback Machine history.

*   **Bypassing the Browser Queue**: Like the Lighthouse Engine, website age auditing does not use headless browser pages. It executes simple HTTP fetches directly to the Wayback Machine API endpoints, allowing parallel executions that bypass the browser single-concurrency queue.
*   **Double-Check Sequence (Availability First)**: 
    *   First checks the Wayback Availability API (`https://archive.org/wayback/available?url=<domain>`).
    *   If status is 200 and closest snapshots are available, it fires the sparkline API fetch. If not, it saves the domain with `available: false` and skips the main sparkline request.
*   **Sparkline Parsing Algorithm**: 
    *   Fetches month-by-month archive counts across all years (`https://web.archive.org/__wb/sparkline?output=json&url=<url>&collection=web`).
    *   Sorts all year keys ascending and finds the first month index with an archive count greater than `0`.
    *   Computes age in years relative to the current baseline year (2026).
*   **MongoDB Schema (`website_ages`)**: Stores normalized URLs, checked dates, availability status, earliest archive year/month details, age in years, and raw sparkline data under the `website_ages` collection. Uses a unique index on the `domain` field to prevent duplicate checks.
