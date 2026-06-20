import { handleRequest } from "./src/api/ask";
import { BrowserManager } from "./src/browser/browser";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

console.log("=========================================");
console.log("     ChatGPT Browser Automation Server   ");
console.log("=========================================");

// Start the Bun server
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    return handleRequest(req);
  },
});

console.log(`[Server] API running at http://localhost:${server.port}`);
console.log("[Server] Endpoints available:");
console.log(`  - POST http://localhost:${server.port}/ask  (Prompt request)`);
console.log(`  - GET  http://localhost:${server.port}/status  (Health and Queue status)`);
console.log(`  - POST http://localhost:${server.port}/login  (Manual headed login trigger)`);
console.log(`  - POST http://localhost:${server.port}/session/reset  (Reset cookies/session)`);

// Handle graceful shutdown
const cleanup = async () => {
  console.log("\n[Server] Shutting down gracefully...");
  await BrowserManager.getInstance().close();
  console.log("[Server] Browser closed. Goodbye!");
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);