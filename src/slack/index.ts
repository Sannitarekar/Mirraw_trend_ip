import type { AppConfig } from "../shared/config.ts";
import { getConfig } from "../shared/config.ts";
import { getLogger } from "../shared/logger.ts";

/**
 * Daily Slack summary to #product-ai (spec Workflow 3 + section 12 alerts).
 * Default mode is a no-op mock so the demo never needs real webhooks; set
 * SLACK_MODE=webhook + SLACK_WEBHOOK_URL for production.
 */
export interface SlackNotifier {
  /** Fire-and-forget message delivery. Never throws to the caller. */
  send(text: string): Promise<void>;
}

export class MockSlackNotifier implements SlackNotifier {
  readonly name = "mock";

  async send(text: string): Promise<void> {
    getLogger().info("slack: (mock) message", { message: text.slice(0, 500) });
  }
}

export class WebhookSlackNotifier implements SlackNotifier {
  readonly name = "webhook";
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(text: string): Promise<void> {
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        getLogger().warn("slack: webhook returned non-2xx", { status: res.status });
      }
    } catch (error) {
      getLogger().warn("slack: webhook delivery failed", { error: (error as Error).message });
    }
  }
}

export function createSlackNotifier(config: AppConfig = getConfig()): SlackNotifier {
  if (config.SLACK_MODE === "webhook" && config.SLACK_WEBHOOK_URL) {
    return new WebhookSlackNotifier(config.SLACK_WEBHOOK_URL);
  }
  return new MockSlackNotifier();
}