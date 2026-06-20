import { BrowserContext } from "playwright";
import { existsSync, readFileSync, writeFileSync, unlinkSync, promises as fs } from "fs";
import { join } from "path";

const SESSION_FILE = join(process.cwd(), "session.json");

/**
 * Checks if the session file exists.
 */
export function hasSession(): boolean {
  return existsSync(SESSION_FILE);
}

/**
 * Converts Chrome extension format cookies to Playwright format cookies.
 */
export function checkAndConvertCookiesJson(): void {
  const cookiesJsonPath = join(process.cwd(), "cookies.json");
  if (existsSync(cookiesJsonPath)) {
    try {
      console.log("[Session] Found cookies.json. Importing cookies...");
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

        // Load existing session.json if it exists to preserve origins/localStorage
        let sessionData: any = { cookies: [], origins: [] };
        if (existsSync(SESSION_FILE)) {
          try {
            sessionData = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
          } catch {}
        }

        // Set the cookies
        sessionData.cookies = playwrightCookies;

        // Save back to session.json
        writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2), "utf-8");
        console.log(`[Session] Successfully imported ${playwrightCookies.length} cookies into session.json.`);

        // Delete cookies.json to avoid re-importing on next startup
        unlinkSync(cookiesJsonPath);
        console.log("[Session] Deleted cookies.json after successful import.");
      }
    } catch (err) {
      console.error("[Session] Error parsing/importing cookies.json:", err);
    }
  }
}

/**
 * Loads the stored storage state (cookies + localStorage) if it exists.
 * Returns the path to the session file or undefined.
 */
export function getSessionStatePath(): string | undefined {
  checkAndConvertCookiesJson();
  return hasSession() ? SESSION_FILE : undefined;
}

/**
 * Saves the current browser context storage state to session.json.
 */
export async function saveSessionState(context: BrowserContext): Promise<void> {
  await context.storageState({ path: SESSION_FILE });
  console.log(`[Session] Browser storage state successfully saved to: ${SESSION_FILE}`);
}

/**
 * Deletes the session.json file to reset login.
 */
export async function deleteSession(): Promise<void> {
  if (hasSession()) {
    await fs.unlink(SESSION_FILE);
    console.log("[Session] Session file deleted.");
  }
}
