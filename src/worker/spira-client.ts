import axios, { AxiosInstance, AxiosError } from "axios";
import { config } from "../config";
import { logger } from "../logger";
import { QueueMessage, RemoteAutomatedTestRun } from "../types";

/**
 * HTTP client for posting results to the real Spira instance.
 * Handles authentication and retry logic.
 */
export class SpiraClient {
  private client: AxiosInstance;

  constructor() {
    if (!config.spira.baseUrl) {
      throw new Error("SPIRA_BASE_URL is not configured");
    }

    this.client = axios.create({
      baseURL: config.spira.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        username: config.spira.username,
        "api-key": config.spira.apiKey,
      },
      timeout: 30000,
    });
  }

  /**
   * Post a single test run result to Spira.
   */
  async recordTestRun(projectId: number, testRun: RemoteAutomatedTestRun): Promise<any> {
    const url = `/Services/v7_0/RestService.svc/projects/${projectId}/test-runs/record`;
    logger.debug("Posting single test run to Spira", { url, testCaseId: testRun.TestCaseId });

    const response = await this.client.post(url, testRun);
    return response.data;
  }

  /**
   * Post multiple test run results to Spira in a single bulk request.
   */
  async recordMultipleTestRuns(projectId: number, testRuns: RemoteAutomatedTestRun[]): Promise<any> {
    const url = `/Services/v7_0/RestService.svc/projects/${projectId}/test-runs/record-multiple`;
    logger.debug("Posting bulk test runs to Spira", { url, count: testRuns.length });

    const response = await this.client.post(url, testRuns);
    return response.data;
  }

  /**
   * Process a queue message by routing to the correct Spira endpoint.
   */
  async processMessage(message: QueueMessage): Promise<any> {
    if (message.endpoint === "record-multiple") {
      return this.recordMultipleTestRuns(
        message.projectId,
        message.payload as RemoteAutomatedTestRun[]
      );
    } else {
      return this.recordTestRun(
        message.projectId,
        message.payload as RemoteAutomatedTestRun
      );
    }
  }

  /**
   * Process a message with retry logic and exponential backoff.
   */
  async processWithRetry(message: QueueMessage): Promise<{ success: boolean; error?: string }> {
    const maxRetries = config.worker.maxRetries;
    const baseDelay = config.worker.retryDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.processMessage(message);
        logger.info("Successfully posted to Spira", {
          messageId: message.id,
          projectId: message.projectId,
          endpoint: message.endpoint,
          testCaseId: Array.isArray(message.payload)
            ? message.payload.map((r) => r.TestCaseId)
            : message.payload.TestCaseId,
          attempt,
        });
        return { success: true };
      } catch (err: any) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;
        const errorMsg = axiosErr.message;

        // Don't retry on 4xx errors (client errors — bad data, won't succeed on retry)
        if (status && status >= 400 && status < 500) {
          logger.error("Non-retryable Spira API error", {
            messageId: message.id,
            status,
            error: errorMsg,
            attempt,
          });
          return { success: false, error: `HTTP ${status}: ${errorMsg}` };
        }

        // Retry on 5xx, network errors, timeouts
        if (attempt < maxRetries) {
          // Full jitter: random delay between 0 and the exponential ceiling.
          // Prevents thundering herd when multiple workers retry simultaneously.
          // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
          const ceiling = baseDelay * Math.pow(2, attempt - 1);
          const delay = Math.floor(Math.random() * ceiling);
          logger.warn("Spira API call failed, retrying with jitter...", {
            messageId: message.id,
            attempt,
            maxRetries,
            ceilingMs: ceiling,
            actualDelayMs: delay,
            error: errorMsg,
          });
          await this.sleep(delay);
        } else {
          logger.error("All retry attempts exhausted", {
            messageId: message.id,
            attempts: maxRetries,
            error: errorMsg,
          });
          return { success: false, error: `Exhausted ${maxRetries} retries: ${errorMsg}` };
        }
      }
    }

    return { success: false, error: "Unexpected fallthrough" };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
