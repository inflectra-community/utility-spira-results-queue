import { Channel, ConsumeMessage } from "amqplib";
import pLimit from "p-limit";
import { config } from "../config";
import { logger } from "../logger";
import { connectRabbitMQ, closeRabbitMQ } from "../rabbitmq";
import { QueueMessage } from "../types";
import { SpiraClient } from "./spira-client";

/**
 * Worker service that consumes messages from RabbitMQ and posts
 * them to the real Spira instance with controlled concurrency.
 *
 * Key behaviors:
 * - Prefetches N messages from RabbitMQ at a time
 * - Processes up to WORKER_CONCURRENCY messages in parallel
 * - Retries failed deliveries with exponential backoff
 * - Nacks (rejects) messages that permanently fail → dead-letter queue
 */
async function main(): Promise<void> {
  logger.info("Starting Spira Results Queue Worker", {
    concurrency: config.worker.concurrency,
    prefetch: config.worker.prefetch,
    maxRetries: config.worker.maxRetries,
    targetSpira: config.spira.baseUrl,
  });

  const channel = await connectRabbitMQ();
  const spiraClient = new SpiraClient();

  // Concurrency limiter — controls how many Spira API calls happen in parallel
  const limit = pLimit(config.worker.concurrency);

  // Prefetch controls how many unacknowledged messages RabbitMQ will deliver
  await channel.prefetch(config.worker.prefetch);

  // Start consuming
  await channel.consume(config.rabbitmq.queue, (msg: ConsumeMessage | null) => {
    if (!msg) return;

    // Process within concurrency limit
    limit(async () => {
      await processMessage(channel, msg, spiraClient);
    });
  });

  logger.info("Worker is consuming from queue", { queue: config.rabbitmq.queue });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down worker...`);
    await closeRabbitMQ();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Process a single message from the queue.
 */
async function processMessage(
  channel: Channel,
  msg: ConsumeMessage,
  spiraClient: SpiraClient
): Promise<void> {
  let message: QueueMessage;

  try {
    message = JSON.parse(msg.content.toString()) as QueueMessage;
  } catch (parseErr: any) {
    logger.error("Failed to parse queue message, rejecting permanently", {
      error: parseErr.message,
      content: msg.content.toString().substring(0, 200),
    });
    // Reject without requeue — will go to dead-letter queue
    channel.nack(msg, false, false);
    return;
  }

  logger.debug("Processing message", {
    messageId: message.id,
    projectId: message.projectId,
    endpoint: message.endpoint,
    enqueuedAt: message.enqueuedAt,
  });

  const result = await spiraClient.processWithRetry(message);

  if (result.success) {
    // Acknowledge successful processing
    channel.ack(msg);
  } else {
    // Permanent failure — nack without requeue (goes to DLQ)
    logger.error("Message processing failed permanently, sending to dead-letter queue", {
      messageId: message.id,
      error: result.error,
    });
    channel.nack(msg, false, false);
  }
}

main().catch((err) => {
  logger.error("Worker failed to start", { error: err.message, stack: err.stack });
  process.exit(1);
});
