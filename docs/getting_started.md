# 🚀 Getting Started

Follow this guide to configure, run, and authenticate the scraper and page auditor application.

---

## 📋 System Prerequisites

Before running the project, ensure you have the following installed on your host system:
1. **Bun**: The native TypeScript/JavaScript runtime.
   - Install via curl: `curl -fsSL https://bun.sh/install | bash`
2. **Playwright Browser Binaries**: Required for browser automation tasks.
   - Installs automatically during dependencies setup.
3. **MongoDB**: A running MongoDB instance (Atlas Cloud cluster or local instance).

---

## 🛠️ Installation

Clone the repository, navigate into the project root, and install all dependencies using Bun:

```bash
# 1. Install dependencies (Playwright, MongoDB client, Bun types)
bun install

# 2. Install Playwright browser engines (Chromium)
bunx playwright install chromium
```

---

## ⚙️ Environment Configuration (`.env`)

Create a `.env` file in the root of the project with the following parameters:

```env
# Application Server Port
PORT=3000

# Google PageSpeed Insights API Key (Optional, fallback to free tier if omitted)
PAGESPEED_API_KEY=your_google_pagespeed_api_key_here

# MongoDB Connection String (Atlas Cluster URI)
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/?appName=defult

# MongoDB Database Name
MONGODB_DATABASE_NAME=master
```

---

## 🍪 Authentication & Self-Healing Session (ChatGPT)

To audit and refine search results using ChatGPT, the browser needs to be authenticated. The system uses a self-healing cookie architecture.

### Step 1: Extract Cookies from Your Browser
1. Log in to [chatgpt.com](https://chatgpt.com) on your main web browser (e.g. Chrome, Brave).
2. Use a browser extension like **Cookie-Editor** or **EditThisCookie** to export all cookies for chatgpt.com.
3. Save the exported JSON content into a file named **`cookies.json`** in the root directory of this project:
   ```json
   // cookies.json (example)
   [
     {
       "name": "__Secure-next-auth.session-token",
       "value": "your-session-token-here",
       "domain": ".chatgpt.com",
       "path": "/",
       "secure": true,
       "httpOnly": true
     }
   ]
   ```

### Step 2: Session Loading & Hot-Reloading
*   **Startup Sync**: When the API server starts, it checks if `cookies.json` exists, converts Chrome extension formats to Playwright formatting, and loads them.
*   **Hot-Reloading**: If you save new cookies to `cookies.json` while the server is active, it automatically injects them into the running browser memory context at runtime—no restart required.
*   **Auto-Persistence**: The browser monitors cookies from response headers and auto-persists active session parameters to prevent token expiration.

### Step 3: Headed Interactive Fallback (Manual Login)
If cookies expire or you want to log in manually:
```bash
# Launch headed browser to login and solve captcha/MFA manually
bun run login
```
Log in in the open browser window. Once complete, close the browser window. The system will save your new state automatically.

---

## 🖥️ Command Line (CLI) Reference

The project includes several built-in scripts configured in `package.json` for running engines directly from the terminal.

| Script | Command | Description |
| :--- | :--- | :--- |
| **`start`** | `bun run start` | Starts the HTTP API Server on the configured port. |
| **`login`** | `bun run login` | Starts headed Chromium for manual ChatGPT login. |
| **`scrape`** | `bun run scrape <keyword> [page]` | Runs the Google scraper CLI and saves raw pages to MongoDB. |
| **`lighthouse`** | `bun run lighthouse <url>` | Generates a PageSpeed audit CLI report and saves to MongoDB. |

### CLI Examples

**Run Google Scrape for a keyword:**
```bash
bun run scrape "reddit marketing tool" 1 2
```

**Generate PageSpeed Audit CLI:**
```bash
bun run lighthouse "https://github.com"
```
