import { BrowserContext } from "playwright";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { connectToDatabase } from "../database/mongo";
import { BROWSER_SESSIONS_COLLECTION } from "../database/models";

/**
 * Checks if the session document exists in MongoDB.
 */
export async function hasSession(): Promise<boolean> {
  try {
    const db = await connectToDatabase();
    const doc = await db.collection(BROWSER_SESSIONS_COLLECTION).findOne({ sessionId: "chatgpt" });
    return !!(doc && doc.sessionData && doc.sessionData.cookies && doc.sessionData.cookies.length > 0);
  } catch (err) {
    console.error("[Session] Error checking session in MongoDB:", err);
    return false;
  }
}

/**
 * Transforms Chrome extension format cookies to Playwright format cookies.
 */
export function transformChromeCookies(chromeCookies: any[]): any[] {
  return chromeCookies.map((c: any) => {
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

    const cookie: any = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite
    };

    // Strip leading dot for __Host- cookies to avoid browser/Playwright validation errors
    if (c.name.startsWith("__Host-") && cookie.domain.startsWith(".")) {
      cookie.domain = cookie.domain.substring(1);
    }

    if (typeof c.expirationDate === "number") {
      cookie.expires = Math.floor(c.expirationDate);
    }

    return cookie;
  });
}

/**
 * Imports a list of Chrome-format cookies directly into MongoDB.
 */
export async function importCookiesList(chromeCookies: any[]): Promise<void> {
  const playwrightCookies = transformChromeCookies(chromeCookies);

  const db = await connectToDatabase();
  const doc = await db.collection(BROWSER_SESSIONS_COLLECTION).findOne({ sessionId: "chatgpt" });
  let sessionData: any = { cookies: [], origins: [] };
  if (doc && doc.sessionData) {
    sessionData = doc.sessionData;
  }

  // Set the cookies
  sessionData.cookies = playwrightCookies;

  // Save back to MongoDB
  await db.collection(BROWSER_SESSIONS_COLLECTION).updateOne(
    { sessionId: "chatgpt" },
    { $set: { sessionData, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log(`[Session] Successfully imported ${playwrightCookies.length} cookies into MongoDB.`);
}

/**
 * Converts Chrome extension format cookies to Playwright format cookies from cookies.json.
 */
export async function checkAndConvertCookiesJson(): Promise<void> {
  const cookiesJsonPath = join(process.cwd(), "cookies.json");
  if (existsSync(cookiesJsonPath)) {
    try {
      console.log("[Session] Found cookies.json. Importing cookies...");
      const rawData = readFileSync(cookiesJsonPath, "utf-8");
      const chromeCookies = JSON.parse(rawData);
      
      if (Array.isArray(chromeCookies)) {
        await importCookiesList(chromeCookies);
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
 * Returns the sessionState object or undefined.
 */
export async function getSessionState(): Promise<any | undefined> {
  await checkAndConvertCookiesJson();
  try {
    const db = await connectToDatabase();
    const doc = await db.collection(BROWSER_SESSIONS_COLLECTION).findOne({ sessionId: "chatgpt" });
    if (doc && doc.sessionData) {
      return doc.sessionData;
    }
  } catch (err) {
    console.error("[Session] Error reading session from MongoDB:", err);
  }
  return undefined;
}

/**
 * Saves the current browser context storage state to MongoDB.
 */
export async function saveSessionState(context: BrowserContext): Promise<void> {
  try {
    const sessionData = await context.storageState();
    // Round or floor the expiration dates of the cookies returned by Playwright to be clean integers
    if (sessionData && Array.isArray(sessionData.cookies)) {
      sessionData.cookies = sessionData.cookies.map((c: any) => {
        if (typeof c.expires === "number") {
          c.expires = Math.floor(c.expires);
        }
        // Ensure __Host- cookies keep a dotless domain format
        if (c.name.startsWith("__Host-") && c.domain && c.domain.startsWith(".")) {
          c.domain = c.domain.substring(1);
        }
        return c;
      });
    }
    const db = await connectToDatabase();
    await db.collection(BROWSER_SESSIONS_COLLECTION).updateOne(
      { sessionId: "chatgpt" },
      { $set: { sessionData, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    console.log("[Session] Browser storage state successfully saved to MongoDB.");
  } catch (err) {
    console.error("[Session] Error saving session to MongoDB:", err);
  }
}

/**
 * Deletes the session document from MongoDB to reset login.
 */
export async function deleteSession(): Promise<void> {
  try {
    const db = await connectToDatabase();
    await db.collection(BROWSER_SESSIONS_COLLECTION).deleteOne({ sessionId: "chatgpt" });
    console.log("[Session] Session document deleted from MongoDB.");
  } catch (err) {
    console.error("[Session] Error deleting session from MongoDB:", err);
  }
}
