import { chromium, Browser, BrowserContext, Page } from "playwright";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getSessionStatePath, saveSessionState } from "./cookies";

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private mainPage: Page | null = null;
  private headless: boolean = process.env.HEADLESS !== "false";

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Automatically hot-reloads cookies.json directly into the active browser memory context.
   */
  private async checkAndHotReloadCookies(): Promise<void> {
    const cookiesJsonPath = join(process.cwd(), "cookies.json");
    if (existsSync(cookiesJsonPath) && this.context) {
      try {
        console.log("[Browser] Active browser context detected cookies.json. Hot-reloading cookies into memory...");
        const rawData = readFileSync(cookiesJsonPath, "utf-8");
        const chromeCookies = JSON.parse(rawData);
        
        if (Array.isArray(chromeCookies)) {
          const playwrightCookies = chromeCookies.map((c: any) => {
            let sameSite: "Lax" | "Strict" | "None" = "Lax";
            if (c.sameSite) {
              const ss = String(c.sameSite).toLowerCase();
              if (ss === "no_restriction" || ss === "none") {
                sameSite = "None";
              } else if (ss === "strict") {
                sameSite = "Strict";
              } else if (ss === "lax") {
                sameSite = "Lax";
              }
            }
            return {
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              expires: typeof c.expirationDate === "number" ? c.expirationDate : undefined,
              httpOnly: !!c.httpOnly,
              secure: !!c.secure,
              sameSite
            };
          });

          // Hot load into the running browser context
          await this.context.addCookies(playwrightCookies);
          console.log(`[Browser] Hot-loaded ${playwrightCookies.length} cookies into memory context.`);

          // Persist back to session.json immediately
          await this.persistSession();

          // Delete cookies.json
          unlinkSync(cookiesJsonPath);
          console.log("[Browser] Deleted cookies.json after hot-reload.");
        }
      } catch (err) {
        console.error("[Browser] Failed to hot-reload cookies.json:", err);
      }
    }
  }

  /**
   * Initializes or returns the active browser instance, context, and a page.
   */
  public async getPage(): Promise<Page> {
    // Attempt to hot-reload cookies if cookies.json is present
    await this.checkAndHotReloadCookies();

    if (this.mainPage && !this.mainPage.isClosed()) {
      return this.mainPage;
    }

    await this.initBrowser();
    return this.mainPage!;
  }

  /**
   * Initializes the browser, context, and a page.
   */
  private async initBrowser(): Promise<void> {
    console.log("[Browser] Launching Chromium...");

    // Close existing instances if any
    await this.close();

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,720"
      ]
    });

    const sessionPath = getSessionStatePath();
    if (sessionPath) {
      console.log(`[Browser] Loading existing session state from: ${sessionPath}`);
    } else {
      console.log("[Browser] No session state found. Browser will start unauthenticated.");
    }

    this.context = await this.browser.newContext({
      storageState: sessionPath,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      timezoneId: "America/New_York"
    });

    // Auto-save session cookies when set-cookie headers are received from server responses
    let saveTimeout: any = null;
    this.context.on("response", (response) => {
      const headers = response.headers();
      if (headers["set-cookie"]) {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
          try {
            await this.persistSession();
          } catch {}
        }, 1000);
      }
    });

    // Simple anti-detect scripts
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    this.mainPage = await this.context.newPage();
    console.log("[Browser] Browser initialized successfully.");
  }

  /**
   * Force saves the current storage state.
   */
  public async persistSession(): Promise<void> {
    if (this.context) {
      await saveSessionState(this.context);
    }
  }

  /**
   * Launches a temporary headed browser context to let the user login manually.
   * Saves the cookies and storage state upon successful login, then closes the headed browser.
   */
  public async runInteractiveLogin(): Promise<void> {
    console.log("[Browser] Starting headed browser for manual login...");
    const headedBrowser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const context = await headedBrowser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();
    await page.goto("https://chatgpt.com");

    console.log("[Browser] Please log in to ChatGPT in the opened browser window.");
    console.log("[Browser] Waiting for successful login (detecting chat input field)...");

    // Wait for the prompt textarea to appear (signaling login completion)
    try {
      await page.waitForSelector("#prompt-textarea", { timeout: 300000 }); // 5 minutes timeout
      console.log("[Browser] Login detected! Saving session state...");
      await saveSessionState(context);
      console.log("[Browser] Session saved successfully.");
    } catch (error) {
      console.error("[Browser] Login timed out or failed:", error);
    } finally {
      await headedBrowser.close();
      // Re-initialize our headless browser instance to pick up the new session
      await this.initBrowser();
    }
  }

  /**
   * Closes the browser and cleans up resources.
   */
  public async close(): Promise<void> {
    if (this.context) {
      try {
        await this.persistSession();
      } catch (err) {
        console.warn("[Browser] Error saving session state during browser cleanup:", err);
      }
    }
    if (this.mainPage) {
      try {
        await this.mainPage.close();
      } catch {}
      this.mainPage = null;
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {}
      this.context = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
  }
}
