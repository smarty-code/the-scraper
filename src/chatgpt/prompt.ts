import { Page } from "playwright";

/**
 * Submits the prompt. Supports checking if the prompt was already pre-filled/submitted via the URL.
 * 
 * @param page Playwright Page instance
 * @param prompt The prompt string to submit
 */
export async function submitPrompt(page: Page, prompt: string): Promise<void> {
  const textareaSelector = "#prompt-textarea";
  
  console.log("[Prompt] Waiting for textarea to be active...");
  await page.waitForSelector(textareaSelector, { state: "visible", timeout: 30000 });
  
  // 1. Check if ChatGPT already started generating (in case of auto-submit via the URL parameter)
  const isGeneratingAlready = await page.evaluate(() => {
    const stopBtn = document.querySelector('[data-testid="stop-button"]') ||
                    document.querySelector('button[aria-label="Stop generating"]');
    const sendBtn = document.querySelector('[data-testid="send-button"]') || 
                    document.querySelector('[data-testid="fruitjuice-send-button"]');
    const isSendDisabled = sendBtn ? (sendBtn.hasAttribute("disabled") || sendBtn.getAttribute("aria-disabled") === "true") : false;
    
    return !!stopBtn || isSendDisabled;
  });

  if (isGeneratingAlready) {
    console.log("[Prompt] ChatGPT is already generating response (auto-submitted via URL parameter).");
    return;
  }

  // Focus and check if the prompt text is already populated in the editor
  await page.focus(textareaSelector);
  const currentText = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el as HTMLElement).innerText || "" : "";
  }, textareaSelector);

  // 2. If it is empty, insert the prompt. Otherwise, proceed to submit.
  if (currentText.trim() === "") {
    console.log("[Prompt] Textarea is empty. Typing prompt...");
    try {
      // Clear and type cleanly
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.insertText(prompt);
    } catch (err) {
      console.warn("[Prompt] Keyboard insertion failed, falling back to page.fill:", err);
      await page.fill(textareaSelector, prompt);
    }
    // Give UI a brief moment to update state
    await page.waitForTimeout(200);
  } else {
    console.log("[Prompt] Textarea is already populated (via URL parameter).");
  }

  console.log("[Prompt] Submitting prompt...");
  
  // Try to click the send button
  const sendButtonSelectors = [
    '#composer-submit-button',
    '[data-testid="send-button"]',
    '[data-testid="fruitjuice-send-button"]',
    'button[aria-label="Send prompt"]'
  ];

  let submitted = false;
  for (const selector of sendButtonSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn && await btn.isVisible() && !(await btn.isDisabled())) {
        await btn.click();
        console.log(`[Prompt] Clicked send button: ${selector}`);
        submitted = true;
        break;
      }
    } catch {
      // Continue trying other selectors
    }
  }

  // Fallback: If send button wasn't clicked successfully, use the Keyboard press
  if (!submitted) {
    console.log("[Prompt] Send button click skipped or unavailable. Pressing Enter to submit...");
    await page.keyboard.press("Enter");
  }
}

