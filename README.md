# Spira Results Queue

A RabbitMQ-based intermediary service that sits between your test automation and [Spira](https://www.inflectra.com/SpiraTest/) (SpiraTest/SpiraTeam/SpiraPlan). It absorbs high-concurrency result submissions and drains them to Spira at a controlled rate, eliminating database contention and deadlocking during large nightly test cycles.

## The Problem

When hundreds of concurrent test executions report results to Spira simultaneously, the database experiences contention and deadlocking. This service solves that by:

1. Accepting results at any rate via a **Gateway** that exposes the same REST API as Spira
2. Buffering them in **RabbitMQ**
3. Draining them to the real Spira via a **Worker** that limits concurrent API calls to 3–5

## Architecture

```
┌─────────────────┐      ┌──────────────┐      ┌────────────────┐      ┌─────────┐
│  Test Runner 1  │─┐    │              │      │                │      │         │
├─────────────────┤ │    │   Gateway    │      │   RabbitMQ     │      │  Spira  │
│  Test Runner 2  │─┼───▶│  (Express)   │─────▶│   (Queue)      │─────▶│  (Real) │
├─────────────────┤ │    │              │      │                │      │         │
│  Test Runner N  │─┘    │  Port 3000   │      │  Port 5672     │      │         │
└─────────────────┘      └──────────────┘      └────────────────┘      └─────────┘
                          Mimics Spira API       Durable + DLQ          Worker posts
                          Publishes to queue     Persistent msgs        3-5 concurrent
```

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose (for RabbitMQ)

### 1. Clone and Install

```bash
git clone https://github.com/InflectraCommunity/utility-spira-results-queue.git
cd utility-spira-results-queue
npm install
```

### 2. Start RabbitMQ

```bash
docker compose up -d
```

RabbitMQ Management UI will be available at http://localhost:15672 (user: `spira`, pass: `spira123`).

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your real Spira instance details:

```env
SPIRA_BASE_URL=https://your-instance.spiraservice.net
SPIRA_USERNAME=your-username
SPIRA_API_KEY=your-api-key
```

### 4. Build and Run

```bash
# Development (with ts-node, hot compilation)
npm run dev

# Production
npm run build
npm start
```

This starts both the Gateway (port 3000) and the Worker process.

## How to Switch Your Test Runners

The entire point of this service is that **your test runners don't need code changes** — just a URL change.

### Before (direct to Spira)

```
Base URL: https://your-instance.spiraservice.net
Endpoint: /Services/v7_0/RestService.svc/projects/1/test-runs/record
```

### After (through the queue)

```
Base URL: http://your-queue-host:3000
Endpoint: /Services/v7_0/RestService.svc/projects/1/test-runs/record
```

That's it. The gateway exposes the exact same path structure as Spira's REST API. Change the base URL in your test framework configuration (or override the `SPIRA_URL` environment variable if your framework supports one) and results will flow through the queue.

### Supported Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/Services/v7_0/RestService.svc/projects/{id}/test-runs/record` | POST | Record a single automated test run |
| `/Services/v7_0/RestService.svc/projects/{id}/test-runs/record-multiple` | POST | Bulk record multiple test runs |
| `/Services/v6_0/RestService.svc/projects/{id}/test-runs/record` | POST | v6 backward compatibility |
| `/Services/v6_0/RestService.svc/projects/{id}/test-runs/record-multiple` | POST | v6 bulk backward compatibility |
| `/api/v7/projects/{id}/test-runs/record` | POST | Shorthand alias |
| `/api/v7/projects/{id}/test-runs/record-multiple` | POST | Shorthand bulk alias |
| `/health` | GET | Health check |

### Example: Recording a Single Test Run

```bash
curl -X POST http://localhost:3000/Services/v7_0/RestService.svc/projects/1/test-runs/record \
  -H "Content-Type: application/json" \
  -d '{
    "TestCaseId": 123,
    "ReleaseId": 45,
    "ExecutionStatusId": 2,
    "TestRunFormatId": 1,
    "StartDate": "2024-05-14T14:00:00.000Z",
    "EndDate": "2024-05-14T14:10:00.000Z",
    "RunnerName": "PyTest-Framework",
    "RunnerTestName": "LoginValidation",
    "RunnerMessage": "Test passed successfully.",
    "RunnerStackTrace": null,
    "AutomationHostId": 1
  }'
```

### Example: Bulk Recording

```bash
curl -X POST http://localhost:3000/Services/v7_0/RestService.svc/projects/1/test-runs/record-multiple \
  -H "Content-Type: application/json" \
  -d '[
    {
      "TestCaseId": 123,
      "ExecutionStatusId": 2,
      "TestRunFormatId": 1,
      "StartDate": "2024-05-14T14:00:00.000Z",
      "EndDate": "2024-05-14T14:10:00.000Z",
      "RunnerName": "MyFramework",
      "RunnerTestName": "Test1"
    },
    {
      "TestCaseId": 124,
      "ExecutionStatusId": 1,
      "TestRunFormatId": 1,
      "StartDate": "2024-05-14T14:10:00.000Z",
      "EndDate": "2024-05-14T14:11:00.000Z",
      "RunnerName": "MyFramework",
      "RunnerTestName": "Test2",
      "RunnerMessage": "Assertion failed at line 42"
    }
  ]'
```

## Configuration Reference

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_PORT` | `3000` | Port the gateway listens on |
| `GATEWAY_HOST` | `0.0.0.0` | Host binding |
| `RABBITMQ_URL` | `amqp://spira:spira123@localhost:5672` | AMQP connection string |
| `RABBITMQ_QUEUE` | `spira-test-results` | Queue name |
| `RABBITMQ_EXCHANGE` | `spira-results` | Exchange name |
| `RABBITMQ_ROUTING_KEY` | `test-run.record` | Routing key |
| `SPIRA_BASE_URL` | — | Your Spira instance URL (required) |
| `SPIRA_USERNAME` | — | Spira API username |
| `SPIRA_API_KEY` | — | Spira RSS token / API key |
| `WORKER_CONCURRENCY` | `3` | Max parallel posts to Spira (3–5 recommended) |
| `WORKER_PREFETCH` | `10` | Messages prefetched from RabbitMQ |
| `WORKER_MAX_RETRIES` | `3` | Retry attempts per message |
| `WORKER_RETRY_DELAY_MS` | `1000` | Base delay for exponential backoff (with full jitter) |
| `GATEWAY_MAX_CONCURRENT` | `50` | Max in-flight requests to gateway |
| `GATEWAY_MAX_QUEUE` | `200` | Max queued requests before rejecting |
| `GATEWAY_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit sliding window (ms) |
| `GATEWAY_RATE_LIMIT_MAX` | `100` | Max requests per IP per window |
| `GATEWAY_MAX_REQUEST_BYTES` | `10485760` | Max request body size (bytes) |
| `LOG_LEVEL` | `info` | Logging verbosity (error/warn/info/debug) |

## Gateway Concurrency Controls

The gateway is intentionally **not** a dumb pass-through. If it accepted unlimited concurrent requests, you'd just shift the contention problem from Spira's DB to RabbitMQ's publish channel and Node.js memory. The gateway applies three layers of protection:

1. **Global concurrency limiter** — caps total in-flight requests (default 50). Excess requests are queued internally (up to 200), then rejected with `503` if the queue fills. This prevents memory exhaustion under burst load.

2. **Per-IP rate limiter** — prevents any single test runner or CI agent from monopolizing the queue. Default: 100 requests per minute per source IP. Returns `429` with `Retry-After` information.

3. **Request size limiter** — early rejection of oversized payloads before buffering into memory.

These defaults are tuned for most environments, but you can adjust them via environment variables if your setup differs.

## Reliability Features

- **Durable queues and persistent messages** — survives RabbitMQ restarts
- **Dead-letter queue** — permanently failed messages go to `spira-test-results.dead` for inspection
- **Exponential backoff with full jitter** — retries are randomized within the exponential ceiling to avoid thundering herd when multiple workers retry simultaneously
- **No retry on 4xx** — bad payloads fail fast and go to DLQ instead of retrying forever
- **Back-pressure handling** — returns 503 if RabbitMQ can't accept messages
- **Graceful shutdown** — SIGINT/SIGTERM cleanly closes connections

## Test Harness

A load-testing script is included to validate the system under realistic concurrency:

```bash
# Default: 200 results, 30 concurrent HTTP connections
npx ts-node test-harness/load-test.ts

# Heavy load: 1000 results, 100 concurrent, bulk mode (batches of 25)
npx ts-node test-harness/load-test.ts --total 1000 --concurrency 100 --bulk-size 25

# Simulate specific project
npx ts-node test-harness/load-test.ts --total 500 --concurrency 50 --project-id 3

# With inter-request delay (simulate realistic timing)
npx ts-node test-harness/load-test.ts --total 200 --concurrency 20 --delay 50
```

The harness reports:
- Throughput (results/sec)
- Latency percentiles (p50, p95, p99)
- HTTP status code breakdown
- Error samples

Use this to validate your concurrency settings before going live. If you see 429s or 503s, increase `GATEWAY_MAX_CONCURRENT` / `GATEWAY_RATE_LIMIT_MAX` or reduce harness concurrency.

## Monitoring

- **RabbitMQ Management UI**: http://localhost:15672 — monitor queue depth, consumer count, message rates
- **Health endpoint**: `GET /health` — returns uptime, queue connection status, and concurrency limits
- **Dead-letter queue**: Check `spira-test-results.dead` queue for messages that permanently failed
- **Logs**: Structured logging via Winston; set `LOG_LEVEL=debug` for verbose output
- **PM2 monitoring**: `pm2 monit` for real-time CPU/memory, `pm2 logs` for aggregated output

## Production Deployment with PM2

[PM2](https://pm2.keymetrics.io/) is the recommended process manager for running the gateway and worker in production. It provides automatic restarts, log management, cluster mode, and startup script generation.

### Install PM2

```bash
npm install -g pm2
```

### Start the Services

```bash
# Build first
npm run build

# Start both gateway and worker via the ecosystem config
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs (combined)
pm2 logs

# View logs for a specific service
pm2 logs spira-queue-gateway
pm2 logs spira-queue-worker
```

### PM2 Commands Reference

```bash
# Restart services (e.g. after deploy)
pm2 restart ecosystem.config.js

# Stop everything
pm2 stop all

# Scale the gateway to 4 instances (cluster mode)
# First update ecosystem.config.js: instances: 4, exec_mode: "cluster"
pm2 restart spira-queue-gateway

# Scale workers for higher throughput
# Each worker instance independently consumes from RabbitMQ
pm2 scale spira-queue-worker 2

# Real-time monitoring dashboard
pm2 monit

# Generate startup script (survives server reboots)
pm2 startup
pm2 save
```

### PM2 Ecosystem Configuration

The included `ecosystem.config.js` defines both services with production-ready defaults:

- **Crash recovery**: auto-restarts with a 2–3s delay, up to 10 restarts
- **Memory limits**: restarts if a process exceeds 512MB
- **Graceful shutdown**: 5s timeout for gateway, 10s for worker (allows in-flight messages to complete)
- **Log files**: written to `logs/` directory with timestamps

### Scaling Guidelines

| Scenario | Gateway Instances | Worker Instances | WORKER_CONCURRENCY |
|----------|:-:|:-:|:-:|
| Light (<100 results/min) | 1 | 1 | 3 |
| Medium (100–500 results/min) | 1 | 2 | 3 |
| Heavy (500–2000 results/min) | 2 (cluster) | 3 | 5 |
| Extreme (2000+ results/min) | 4 (cluster) | 5 | 5 |

Total parallel Spira API calls = `worker instances × WORKER_CONCURRENCY`. Keep this at or below what Spira can comfortably handle (typically 10–15 concurrent connections).

### Docker Production Example

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
CMD ["node", "dist/gateway/server.js"]
```

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
CMD ["node", "dist/worker/worker.js"]
```

## Project Structure

```
├── src/
│   ├── config.ts           # Centralized configuration from env vars
│   ├── logger.ts           # Winston logger setup
│   ├── rabbitmq.ts         # RabbitMQ connection, topology, lifecycle
│   ├── types.ts            # TypeScript interfaces (Spira types, queue messages)
│   ├── gateway/
│   │   ├── server.ts       # Express app bootstrap + middleware
│   │   ├── routes.ts       # Spira-mimicking route handlers
│   │   └── middleware.ts   # Rate limiter, concurrency limiter, size limiter
│   └── worker/
│       ├── worker.ts       # Queue consumer with concurrency control
│       └── spira-client.ts # Axios client for real Spira API with jittered retries
├── test-harness/
│   └── load-test.ts        # Configurable load testing script
├── ecosystem.config.js     # PM2 process manager configuration
├── docker-compose.yml      # RabbitMQ container
├── .env.example            # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
