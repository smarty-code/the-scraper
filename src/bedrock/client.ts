import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AskResult } from "../chatgpt/conversation";
import { AIProvider } from "../ai/provider";

export class BedrockProvider implements AIProvider {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor() {
    const region = process.env.AWS_REGION || "us-east-1";
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || "";
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || "";
    
    // Explicitly configure credentials if provided, otherwise fallback to SDK defaults
    const config: any = { region };
    if (accessKeyId && secretAccessKey) {
      config.credentials = {
        accessKeyId,
        secretAccessKey
      };
    }
    
    this.client = new BedrockRuntimeClient(config);
    this.modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20240620-v1:0";
  }

  public async ask(prompt: string, _deleteConv = true): Promise<AskResult> {
    try {
      console.log(`[Bedrock] Submitting request to modelId: ${this.modelId}`);
      
      const command = new ConverseCommand({
        modelId: this.modelId,
        messages: [
          {
            role: "user",
            content: [{ text: prompt }]
          }
        ]
      });

      const response = await this.client.send(command);
      const responseText = response.output?.message?.content?.[0]?.text;
      
      if (!responseText) {
        console.error("[Bedrock] Invalid or empty response payload:", JSON.stringify(response));
        return {
          success: false,
          rawResponse: JSON.stringify(response),
          error: "Bedrock API returned an empty response or invalid payload structure."
        };
      }

      return {
        success: true,
        answer: responseText,
        rawResponse: JSON.stringify(response),
        method: "network"
      };
    } catch (err: any) {
      console.error("[Bedrock] Error during ask:", err);
      return {
        success: false,
        error: err.message || String(err)
      };
    }
  }
}
