import amqplib, { Channel } from "amqplib";
import { config } from "./config";
import { logger } from "./logger";

let connection: amqplib.ChannelModel | null = null;
let channel: Channel | null = null;

/**
 * Connect to RabbitMQ, declare exchange and queue, and bind them.
 * Returns the channel for publishing or consuming.
 */
export async function connectRabbitMQ(): Promise<Channel> {
  if (channel) return channel;

  logger.info("Connecting to RabbitMQ...", { url: config.rabbitmq.url.replace(/\/\/.*@/, "//<credentials>@") });

  connection = await amqplib.connect(config.rabbitmq.url);
  channel = await connection.createChannel();

  // Declare a durable direct exchange
  await channel.assertExchange(config.rabbitmq.exchange, "direct", { durable: true });

  // Declare a durable queue with dead-letter support
  await channel.assertQueue(config.rabbitmq.queue, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": `${config.rabbitmq.exchange}.dlx`,
      "x-dead-letter-routing-key": "test-run.dead",
    },
  });

  // Dead-letter exchange and queue for failed messages
  await channel.assertExchange(`${config.rabbitmq.exchange}.dlx`, "direct", { durable: true });
  await channel.assertQueue(`${config.rabbitmq.queue}.dead`, { durable: true });
  await channel.bindQueue(`${config.rabbitmq.queue}.dead`, `${config.rabbitmq.exchange}.dlx`, "test-run.dead");

  // Bind main queue to exchange
  await channel.bindQueue(config.rabbitmq.queue, config.rabbitmq.exchange, config.rabbitmq.routingKey);

  logger.info("RabbitMQ connected and topology declared", {
    exchange: config.rabbitmq.exchange,
    queue: config.rabbitmq.queue,
  });

  // Handle connection errors
  connection.on("error", (err) => {
    logger.error("RabbitMQ connection error", { error: err.message });
    channel = null;
    connection = null;
  });

  connection.on("close", () => {
    logger.warn("RabbitMQ connection closed");
    channel = null;
    connection = null;
  });

  return channel;
}

/**
 * Gracefully close the RabbitMQ connection.
 */
export async function closeRabbitMQ(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
  }
  logger.info("RabbitMQ connection closed gracefully");
}
