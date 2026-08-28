import { Router, Request, Response } from "express";
import { Channel } from "amqplib";
import { randomUUID } from "crypto";
import { config } from "../config";
import { logger } from "../logger";
import { QueueMessage, RemoteAutomatedTestRun } from "../types";

/**
 * Creates the Express router that mimics Spira's test-run recording endpoints.
 * Instead of forwarding to Spira, it publishes messages to RabbitMQ.
 */
export function createResultsRouter(channel: Channel): Router {
  const router = Router();

  /**
   * POST /projects/{project_id}/test-runs/record
   *
   * Mimics the Spira endpoint for recording a single automated test run.
   * Accepts a RemoteAutomatedTestRun JSON body.
   */
  router.post("/projects/:projectId/test-runs/record", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) {
        return res.status(400).json({ error: "Invalid project_id parameter" });
      }

      const testRun: RemoteAutomatedTestRun = req.body;
      if (!testRun.TestCaseId || !testRun.ExecutionStatusId) {
        return res.status(400).json({ error: "TestCaseId and ExecutionStatusId are required" });
      }

      const message: QueueMessage = {
        id: randomUUID(),
        enqueuedAt: new Date().toISOString(),
        projectId,
        endpoint: "record",
        payload: testRun,
        attempts: 0,
      };

      const published = channel.publish(
        config.rabbitmq.exchange,
        config.rabbitmq.routingKey,
        Buffer.from(JSON.stringify(message)),
        { persistent: true, messageId: message.id, contentType: "application/json" }
      );

      if (!published) {
        logger.warn("RabbitMQ publish returned false (back-pressure)", { messageId: message.id });
        return res.status(503).json({ error: "Queue is full, try again later" });
      }

      logger.info("Enqueued test run result", {
        messageId: message.id,
        projectId,
        testCaseId: testRun.TestCaseId,
        status: testRun.ExecutionStatusId,
      });

      // Return a response that looks like what Spira would return
      return res.status(200).json({
        TestRunId: null, // Will be assigned when actually posted to Spira
        Message: "Result queued successfully",
        QueueMessageId: message.id,
        ProjectId: projectId,
      });
    } catch (err: any) {
      logger.error("Error enqueuing single test run", { error: err.message });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /projects/{project_id}/test-runs/record-multiple
   *
   * Mimics the Spira v7 bulk endpoint for recording multiple automated test runs.
   * Accepts an array of RemoteAutomatedTestRun objects.
   */
  router.post("/projects/:projectId/test-runs/record-multiple", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) {
        return res.status(400).json({ error: "Invalid project_id parameter" });
      }

      const testRuns: RemoteAutomatedTestRun[] = req.body;
      if (!Array.isArray(testRuns) || testRuns.length === 0) {
        return res.status(400).json({ error: "Request body must be a non-empty array of test runs" });
      }

      const message: QueueMessage = {
        id: randomUUID(),
        enqueuedAt: new Date().toISOString(),
        projectId,
        endpoint: "record-multiple",
        payload: testRuns,
        attempts: 0,
      };

      const published = channel.publish(
        config.rabbitmq.exchange,
        config.rabbitmq.routingKey,
        Buffer.from(JSON.stringify(message)),
        { persistent: true, messageId: message.id, contentType: "application/json" }
      );

      if (!published) {
        logger.warn("RabbitMQ publish returned false (back-pressure)", { messageId: message.id });
        return res.status(503).json({ error: "Queue is full, try again later" });
      }

      logger.info("Enqueued bulk test run results", {
        messageId: message.id,
        projectId,
        count: testRuns.length,
      });

      return res.status(200).json({
        Message: "Results queued successfully",
        QueueMessageId: message.id,
        ProjectId: projectId,
        Count: testRuns.length,
      });
    } catch (err: any) {
      logger.error("Error enqueuing bulk test runs", { error: err.message });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /test-runs/record-multiple (without project in path)
   *
   * Some automation frameworks use the non-project-scoped bulk endpoint.
   * Requires project_id to be present in each test run object or as a query param.
   */
  router.post("/test-runs/record-multiple", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.query.project_id as string, 10);
      if (isNaN(projectId)) {
        return res.status(400).json({
          error: "project_id query parameter is required for the non-scoped endpoint",
        });
      }

      const testRuns: RemoteAutomatedTestRun[] = req.body;
      if (!Array.isArray(testRuns) || testRuns.length === 0) {
        return res.status(400).json({ error: "Request body must be a non-empty array of test runs" });
      }

      const message: QueueMessage = {
        id: randomUUID(),
        enqueuedAt: new Date().toISOString(),
        projectId,
        endpoint: "record-multiple",
        payload: testRuns,
        attempts: 0,
      };

      const published = channel.publish(
        config.rabbitmq.exchange,
        config.rabbitmq.routingKey,
        Buffer.from(JSON.stringify(message)),
        { persistent: true, messageId: message.id, contentType: "application/json" }
      );

      if (!published) {
        return res.status(503).json({ error: "Queue is full, try again later" });
      }

      logger.info("Enqueued bulk test run results (non-scoped)", {
        messageId: message.id,
        projectId,
        count: testRuns.length,
      });

      return res.status(200).json({
        Message: "Results queued successfully",
        QueueMessageId: message.id,
        ProjectId: projectId,
        Count: testRuns.length,
      });
    } catch (err: any) {
      logger.error("Error enqueuing bulk test runs (non-scoped)", { error: err.message });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
