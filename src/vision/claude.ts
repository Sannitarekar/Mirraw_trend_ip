import { getConfig } from "../shared/config.ts";
import { HttpError } from "../collectors/common/retry.ts";
import { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./prompt.ts";
import type { TrendAttributes, VisionImageInput, VisionProvider } from "./types.ts";
import { parseVisionJson } from "./validation.ts";

/**
 * Claude Vision provider (claude-sonnet-4) via the Anthropic Messages API.
 *
 * A small fetch-based client (no SDK dependency) so timeout behavior is fully
 * under our control. The analysis workflow applies the spec's retry policy
 * (3 attempts, 30s delay, then analysis_failed); this provider makes a single
 * call and surfaces HTTP statuses so the workflow can classify failures.
 */
export class ClaudeVisionProvider implements VisionProvider {
  readonly name = "claude";
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(apiKey?: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async analyze(image: VisionImageInput): Promise<TrendAttributes> {
    const cfg = getConfig();
    const apiKey = this.apiKey ?? cfg.ANTHROPIC_API_KEY;
    const model = this.model ?? cfg.VISION_MODEL;
    const baseUrl = (this.baseUrl ?? cfg.ANTHROPIC_BASE_URL).replace(/\/+$/, "");

    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for the Claude Vision provider");
    }

    const mimeType = image.mimeType ?? "image/jpeg";
    const base64 = Buffer.from(image.bytes).toString("base64");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: VISION_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mimeType, data: base64 },
                },
                { type: "text", text: VISION_USER_PROMPT },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new HttpError(
          `claude vision ${response.status}: ${detail.slice(0, 200)}`,
          response.status,
        );
      }

      const body = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = body.content?.find((block) => block.type === "text")?.text ?? "";
      return parseVisionJson(text);
    } finally {
      clearTimeout(timer);
    }
  }
}