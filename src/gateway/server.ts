import express from "express";
import { config } from "../config";
import { logger } from "../logger";
import { connectRabbitMQ, closeRabbitMQ } from "../rabbitmq";
import { createResultsRouter } from "./routes";
import { rateLimiter, concurrencyLimiter, requestSizeLimiter } from "./middleware";

async function main(): Promise<void> {
  const app = express();

  // ---------------------------------------------------------------------------
  // Concurrency & Rate-Limiting Controls
  // These ensure the gateway doesn't just replicate Spira's bottleneck by
  // accepting unbounded requests. The queue is the buffer — the gateway
  // must protect itself and RabbitMQ from being overwhelmed.
  // ---------------------------------------------------------------------------

  // 1. Global concurrency limiter — caps in-flight requests, queues overflow
  app.use(
    concurrencyLimiter({
      maxConcurrent: config.gateway.maxConcurrent,
      maxQueue: config.gateway.maxQueue,
    })
  );

  // 2. Per-IP rate limiter — prevents any single source from flooding
  app.use(
    rateLimiter({
      maxRequests: config.gateway.rateLimitMax,
      windowMs: config.gateway.rateLimitWindow,
      message: "Rate limit exceeded. The queue accepts results at a controlled rate to prevent overload.",
    })
  );

  // 3. Request size limiter — early rejection before buffering large bodies
  app.use(requestSizeLimiter(config.gateway.maxRequestBytes));

  // Parse JSON bodies (Spira API uses JSON)
  app.use(express.json({ limit: `${Math.ceil(config.gateway.maxRequestBytes / 1024 / 1024)}mb` }));

  // Request logging middleware
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`, { query: req.query });
    next();
  });

  // Connect to RabbitMQ
  const channel = await connectRabbitMQ();

  // Mount the Spira-compatible routes
  const resultsRouter = createResultsRouter(channel);
  // Spira v7 REST path pattern: /Services/v7_0/RestService.svc/...
  app.use("/Services/v7_0/RestService.svc", resultsRouter);
  // Also support versioned shorthand for convenience
  app.use("/api/v7", resultsRouter);
  // Support older v6 path for backward compatibility
  app.use("/Services/v6_0/RestService.svc", resultsRouter);

  // Health check — includes concurrency info
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      queue: config.rabbitmq.queue,
      uptime: process.uptime(),
      limits: {
        maxConcurrent: config.gateway.maxConcurrent,
        maxQueue: config.gateway.maxQueue,
        rateLimitPerMinute: config.gateway.rateLimitMax,
      },
    });
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint not found. This service only proxies test-run recording endpoints." });
  });

  // Start listening
  app.listen(config.gateway.port, config.gateway.host, () => {
    logger.info(`Gateway listening on http://${config.gateway.host}:${config.gateway.port}`);
    logger.info("Concurrency controls active", {
      maxConcurrent: config.gateway.maxConcurrent,
      maxQueue: config.gateway.maxQueue,
      rateLimitMax: `${config.gateway.rateLimitMax} req/${config.gateway.rateLimitWindow}ms per IP`,
    });
    logger.info("Mimicking Spira REST API — test runners can POST results here instead of directly to Spira");
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gateway...`);
    await closeRabbitMQ();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Gateway failed to start", { error: err.message, stack: err.stack });
  process.exit(1);
});
