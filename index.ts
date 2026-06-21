import "./src/polyfill";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

console.log("=========================================");
console.log("     ChatGPT Browser Automation Server   ");
console.log("=========================================");

// Dynamically import the rest to guarantee the polyfill runs first
const { handleRequest } = await import("./src/api/ask");
const { BrowserManager } = await import("./src/browser/browser");
const { closeDatabaseConnection } = await import("./src/database/mongo");

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
  await closeDatabaseConnection();
  console.log("[Server] Browser and Database connections closed. Goodbye!");
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);