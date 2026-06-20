import { BrowserContext } from "playwright";
import { existsSync, promises as fs } from "fs";
import { join } from "path";

const SESSION_FILE = join(process.cwd(), "session.json");

/**
 * Checks if the session file exists.
 */
export function hasSession(): boolean {
  return existsSync(SESSION_FILE);
}

/**
 * Loads the stored storage state (cookies + localStorage) if it exists.
 * Returns the path to the session file or undefined.
 */
export function getSessionStatePath(): string | undefined {
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
