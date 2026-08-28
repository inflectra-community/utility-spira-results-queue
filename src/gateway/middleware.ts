import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Rate Limiter — sliding window per-IP
// ---------------------------------------------------------------------------

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Message returned when rate limited */
  message?: string;
}

/**
 * Creates a rate-limiting middleware using a sliding window per source IP.
 * This prevents any single test runner from flooding the queue.
 */
export function rateLimiter(options: RateLimiterOptions) {
  const { maxRequests, windowMs, message } = options;
  const windows = new Map<string, RateLimitWindow>();

  // Periodic cleanup of expired entries to prevent memory leaks
  setInterval(() => {
    const now = Date.now();
    for (const [key, window] of windows) {
      if (now > window.resetAt) windows.delete(key);
    }
  }, windowMs * 2).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let window = windows.get(key);
    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }

    window.count++;

    // Set rate limit headers (standard draft)
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - window.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(window.resetAt / 1000));

    if (window.count > maxRequests) {
      logger.warn("Rate limit exceeded", { ip: key, count: window.count, maxRequests });
      res.status(429).json({
        error: message || "Too many requests. Please slow down.",
        retryAfterMs: window.resetAt - now,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Global Concurrency Limiter — caps total in-flight requests to the gateway
// ---------------------------------------------------------------------------

interface ConcurrencyLimiterOptions {
  /** Max concurrent requests being processed */
  maxConcurrent: number;
  /** Max requests waiting in the internal queue before rejecting */
  maxQueue: number;
}

/**
 * Limits the total number of requests being processed concurrently by the gateway.
 * Excess requests are queued up to maxQueue, then rejected with 503.
 *
 * This is the key control: even though the gateway is lightweight, if thousands
 * of results arrive at once we don't want to overwhelm RabbitMQ's publish channel
 * or exhaust Node.js memory buffering enormous request bodies.
 */
export function concurrencyLimiter(options: ConcurrencyLimiterOptions) {
  const { maxConcurrent, maxQueue } = options;
  let active = 0;
  const queue: Array<() => void> = [];

  return (req: Request, res: Response, next: NextFunction): void => {
    const proceed = () => {
      active++;

      // When the response finishes, release the slot
      const release = () => {
        active--;
        if (queue.length > 0) {
          const nextInQueue = queue.shift()!;
          nextInQueue();
        }
      };
      res.on("finish", release);
      res.on("close", release);

      next();
    };

    if (active < maxConcurrent) {
      proceed();
    } else if (queue.length < maxQueue) {
      // Queue the request
      queue.push(proceed);
    } else {
      // Queue is full — reject
      logger.warn("Gateway overloaded, rejecting request", {
        active,
        queued: queue.length,
        maxConcurrent,
        maxQueue,
      });
      res.status(503).json({
        error: "Service temporarily overloaded. Please retry shortly.",
        active,
        queued: queue.length,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Request Size Limiter — prevent oversized payloads
// ---------------------------------------------------------------------------

/**
 * Rejects requests with bodies larger than the specified limit.
 * Express's json() limit handles parsing, but this provides an early rejection
 * based on Content-Length before buffering the body.
 */
export function requestSizeLimiter(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > maxBytes) {
      logger.warn("Request too large", { contentLength, maxBytes });
      res.status(413).json({
        error: `Request body too large. Maximum allowed: ${(maxBytes / 1024 / 1024).toFixed(1)}MB`,
      });
      return;
    }
    next();
  };
}
