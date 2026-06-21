import "../polyfill";
import { BrowserManager } from "./browser";

// Set headed mode for interactive login
process.env.HEADLESS = "false";

async function run() {
  console.log("=========================================");
  console.log("   ChatGPT Session Authentication Setup  ");
  console.log("=========================================");
  
  const manager = BrowserManager.getInstance();
  try {
    await manager.runInteractiveLogin();
    console.log("\nSuccess! You can now run the API server using Bun.");
  } catch (error) {
    console.error("Authentication flow encountered an error:", error);
  } finally {
    await manager.close();
    process.exit(0);
  }
}

run();
