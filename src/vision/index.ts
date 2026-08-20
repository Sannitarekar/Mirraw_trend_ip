import { getConfig } from "../shared/config.ts";
import { ClaudeVisionProvider } from "./claude.ts";
import { MockVisionProvider } from "./mock.ts";
import type { VisionProvider } from "./types.ts";

/**
 * Vision provider factory.
 *
 * - VISION_PROVIDER=mock   -> deterministic mock (default demo, no API key)
 * - VISION_PROVIDER=claude -> real claude-sonnet-4 via Anthropic
 */
export function createVisionProvider(provider?: string): VisionProvider {
  const cfg = getConfig();
  switch (provider ?? cfg.VISION_PROVIDER) {
    case "claude":
      return new ClaudeVisionProvider();
    case "mock":
    default:
      return new MockVisionProvider();
  }
}

export type { TrendAttributes, VisionImageInput, VisionProvider } from "./types.ts";
export { UNKNOWN, ATTRIBUTE_KEYS, VisionMalformedResponseError } from "./types.ts";
export { validateTrendAttributes, parseVisionJson } from "./validation.ts";
export { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./prompt.ts";