import dotenv from "dotenv";
dotenv.config();

export const config = {
  gateway: {
    port: parseInt(process.env.GATEWAY_PORT || "3000", 10),
    host: process.env.GATEWAY_HOST || "0.0.0.0",
    // Concurrency controls
    maxConcurrent: parseInt(process.env.GATEWAY_MAX_CONCURRENT || "50", 10),
    maxQueue: parseInt(process.env.GATEWAY_MAX_QUEUE || "200", 10),
    // Rate limiting per IP
    rateLimitWindow: parseInt(process.env.GATEWAY_RATE_LIMIT_WINDOW_MS || "60000", 10),
    rateLimitMax: parseInt(process.env.GATEWAY_RATE_LIMIT_MAX || "100", 10),
    // Request size limit in bytes (default 10MB)
    maxRequestBytes: parseInt(process.env.GATEWAY_MAX_REQUEST_BYTES || String(10 * 1024 * 1024), 10),
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672",
    queue: process.env.RABBITMQ_QUEUE || "spira-test-results",
    exchange: process.env.RABBITMQ_EXCHANGE || "spira-results",
    routingKey: process.env.RABBITMQ_ROUTING_KEY || "test-run.record",
  },

  spira: {
    baseUrl: process.env.SPIRA_BASE_URL || "",
    apiKey: process.env.SPIRA_API_KEY || "",
    username: process.env.SPIRA_USERNAME || "",
  },

  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "3", 10),
    prefetch: parseInt(process.env.WORKER_PREFETCH || "10", 10),
    maxRetries: parseInt(process.env.WORKER_MAX_RETRIES || "3", 10),
    retryDelayMs: parseInt(process.env.WORKER_RETRY_DELAY_MS || "1000", 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
};
