import { Page } from "playwright";

/**
 * Monitors the ChatGPT DOM to wait until the current generation completes.
 * Uses a polling loop to inspect the state of the Send and Stop buttons.
 * 
 * @param page Playwright Page instance
 * @param timeoutMs Timeout in milliseconds
 */
export async function waitForGenerationComplete(page: Page, timeoutMs = 180000): Promise<void> {
  const start = Date.now();
  console.log("[Watcher] Waiting for response to start and complete...");

  // Give the UI a moment (1s) to register the enter key/button click and change state
  await page.waitForTimeout(1000);

  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      // Common ChatGPT selectors
      const sendBtn = document.querySelector("#composer-submit-button") ||
                      document.querySelector('[data-testid="send-button"]') || 
                      document.querySelector('[data-testid="fruitjuice-send-button"]');
      const stopBtn = document.querySelector('[data-testid="stop-button"]') ||
                      document.querySelector('button[aria-label="Stop generating"]');
      const textarea = document.querySelector("#prompt-textarea") as HTMLTextAreaElement | null;

      // ChatGPT shows a disabled/modified send button or a stop button when generating
      const hasStopBtn = !!stopBtn;
      const isSendDisabled = sendBtn ? (sendBtn.hasAttribute("disabled") || sendBtn.getAttribute("aria-disabled") === "true") : false;
      const isTextareaDisabled = textarea ? 
        (textarea.getAttribute("contenteditable") === "false" || 
         textarea.getAttribute("aria-disabled") === "true" || 
         (textarea as any).disabled === true) : false;
      
      const isGenerating = hasStopBtn || isSendDisabled || isTextareaDisabled;

      return {
        isGenerating,
        hasSendBtn: !!sendBtn,
        hasStopBtn,
        isTextareaDisabled
      };
    });

    // If it is not generating, and the text area is enabled, and the send button is present
    if (!state.isGenerating && state.hasSendBtn) {
      console.log("[Watcher] Generation finished successfully.");
      return;
    }

    // Wait a brief period before checking again
    await page.waitForTimeout(500);
  }

  throw new Error(`Response generation timed out after ${timeoutMs}ms`);
}
