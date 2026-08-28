/**
 * Test Harness — Load Test for Spira Results Queue Gateway
 *
 * Simulates hundreds of concurrent test runners posting results to the gateway.
 * Configurable via CLI args or environment variables.
 *
 * Usage:
 *   npx ts-node test-harness/load-test.ts
 *   npx ts-node test-harness/load-test.ts --total 500 --concurrency 50 --bulk-size 10
 *
 * Environment variables (override defaults):
 *   HARNESS_GATEWAY_URL    - Gateway base URL (default: http://localhost:3000)
 *   HARNESS_TOTAL          - Total results to send (default: 200)
 *   HARNESS_CONCURRENCY    - Max concurrent HTTP requests in flight (default: 30)
 *   HARNESS_PROJECT_ID     - Spira project ID to use (default: 1)
 *   HARNESS_BULK_SIZE      - If set, send bulk batches of this size instead of singles
 *   HARNESS_DELAY_MS       - Optional delay between request batches (default: 0)
 */

import axios, { AxiosInstance } from "axios";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface HarnessConfig {
  gatewayUrl: string;
  totalResults: number;
  concurrency: number;
  projectId: number;
  bulkSize: number; // 0 = send singles, >0 = send in bulk batches of this size
  delayMs: number;
}

function parseArgs(): HarnessConfig {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  return {
    gatewayUrl: get("--url", process.env.HARNESS_GATEWAY_URL || "http://localhost:3000"),
    totalResults: parseInt(get("--total", process.env.HARNESS_TOTAL || "200"), 10),
    concurrency: parseInt(get("--concurrency", process.env.HARNESS_CONCURRENCY || "30"), 10),
    projectId: parseInt(get("--project-id", process.env.HARNESS_PROJECT_ID || "1"), 10),
    bulkSize: parseInt(get("--bulk-size", process.env.HARNESS_BULK_SIZE || "0"), 10),
    delayMs: parseInt(get("--delay", process.env.HARNESS_DELAY_MS || "0"), 10),
  };
}

// ---------------------------------------------------------------------------
// Test Data Generation
// ---------------------------------------------------------------------------

const RUNNER_NAMES = [
  "PyTest-Suite",
  "JUnit-Runner",
  "NUnit-Framework",
  "Cypress-E2E",
  "Playwright-Tests",
  "Selenium-Grid",
  "Jest-Unit",
  "xUnit-Integration",
  "Robot-Framework",
  "TestNG-Automation",
];

const TEST_NAMES = [
  "LoginFlow_ValidCredentials",
  "LoginFlow_InvalidPassword",
  "Dashboard_LoadWidgets",
  "API_CreateProject",
  "API_DeleteArtifact",
  "UI_NavigationMenu",
  "UI_FormValidation",
  "DB_MigrationRollback",
  "Performance_PageLoad",
  "Security_XSSPrevention",
  "Integration_WebhookDelivery",
  "Regression_SearchFilter",
  "Smoke_HealthCheck",
  "E2E_CheckoutWorkflow",
  "Unit_DateFormatting",
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateTestRun(index: number) {
  const startDate = new Date(Date.now() - randomInt(60000, 3600000));
  const durationMs = randomInt(500, 30000);
  const endDate = new Date(startDate.getTime() + durationMs);
  const passed = Math.random() > 0.2; // 80% pass rate

  return {
    TestCaseId: randomInt(1, 500),
    ReleaseId: randomInt(1, 10),
    TestSetId: randomInt(1, 20),
    TestSetTestCaseId: randomInt(1, 1000),
    ExecutionStatusId: passed ? 2 : 1,
    TestRunFormatId: 1,
    StartDate: startDate.toISOString(),
    EndDate: endDate.toISOString(),
    RunnerName: randomElement(RUNNER_NAMES),
    RunnerTestName: `${randomElement(TEST_NAMES)}_${index}`,
    RunnerMessage: passed
      ? "Test passed successfully."
      : `Assertion failed: expected true but got false (iteration ${index})`,
    RunnerStackTrace: passed
      ? null
      : `Error: AssertionError\n    at Context.<anonymous> (test_${index}.spec.ts:${randomInt(10, 200)}:${randomInt(1, 40)})\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`,
    AutomationHostId: randomInt(1, 5),
  };
}

// ---------------------------------------------------------------------------
// Concurrency-Limited Executor
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  delayMs: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  let completed = 0;
  const total = tasks.length;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= total) break;

      const result = await tasks[currentIndex]();
      results[currentIndex] = result;
      completed++;

      if (completed % 50 === 0 || completed === total) {
        const pct = ((completed / total) * 100).toFixed(1);
        process.stdout.write(`\r  Progress: ${completed}/${total} (${pct}%)`);
      }

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  process.stdout.write("\n");

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RequestResult {
  success: boolean;
  status?: number;
  durationMs: number;
  error?: string;
}

async function main() {
  const cfg = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         Spira Results Queue — Load Test Harness             ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Gateway URL:    ${cfg.gatewayUrl.padEnd(42)}║`);
  console.log(`║  Total Results:  ${String(cfg.totalResults).padEnd(42)}║`);
  console.log(`║  Concurrency:    ${String(cfg.concurrency).padEnd(42)}║`);
  console.log(`║  Project ID:     ${String(cfg.projectId).padEnd(42)}║`);
  console.log(`║  Mode:           ${(cfg.bulkSize > 0 ? `Bulk (batch size: ${cfg.bulkSize})` : "Single").padEnd(42)}║`);
  console.log(`║  Inter-batch delay: ${(cfg.delayMs + "ms").padEnd(39)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const client: AxiosInstance = axios.create({
    baseURL: cfg.gatewayUrl,
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
    // Don't throw on non-2xx so we can collect stats
    validateStatus: () => true,
  });

  // Build request tasks
  let tasks: (() => Promise<RequestResult>)[];

  if (cfg.bulkSize > 0) {
    // Bulk mode: group results into batches
    const batches: ReturnType<typeof generateTestRun>[][] = [];
    for (let i = 0; i < cfg.totalResults; i += cfg.bulkSize) {
      const batch = [];
      for (let j = 0; j < cfg.bulkSize && i + j < cfg.totalResults; j++) {
        batch.push(generateTestRun(i + j));
      }
      batches.push(batch);
    }

    console.log(`  Prepared ${batches.length} bulk requests (${cfg.bulkSize} results each)`);
    console.log();

    tasks = batches.map((batch) => async () => {
      const start = Date.now();
      try {
        const res = await client.post(
          `/Services/v7_0/RestService.svc/projects/${cfg.projectId}/test-runs/record-multiple`,
          batch
        );
        return { success: res.status >= 200 && res.status < 300, status: res.status, durationMs: Date.now() - start };
      } catch (err: any) {
        return { success: false, durationMs: Date.now() - start, error: err.message };
      }
    });
  } else {
    // Single mode: one request per result
    console.log(`  Prepared ${cfg.totalResults} individual requests`);
    console.log();

    tasks = Array.from({ length: cfg.totalResults }, (_, i) => {
      const testRun = generateTestRun(i);
      return async () => {
        const start = Date.now();
        try {
          const res = await client.post(
            `/Services/v7_0/RestService.svc/projects/${cfg.projectId}/test-runs/record`,
            testRun
          );
          return { success: res.status >= 200 && res.status < 300, status: res.status, durationMs: Date.now() - start };
        } catch (err: any) {
          return { success: false, durationMs: Date.now() - start, error: err.message };
        }
      };
    });
  }

  // Execute
  const overallStart = Date.now();
  const results = await runWithConcurrency(tasks, cfg.concurrency, cfg.delayMs);
  const overallDuration = Date.now() - overallStart;

  // Report
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const throughput = (cfg.totalResults / (overallDuration / 1000)).toFixed(1);

  // Status code breakdown
  const statusCodes: Record<number, number> = {};
  results.forEach((r) => {
    if (r.status) statusCodes[r.status] = (statusCodes[r.status] || 0) + 1;
  });

  console.log();
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│                        RESULTS                               │");
  console.log("├──────────────────────────────────────────────────────────────┤");
  console.log(`│  Total Requests:    ${String(tasks.length).padEnd(40)}│`);
  console.log(`│  Total Results:     ${String(cfg.totalResults).padEnd(40)}│`);
  console.log(`│  Successful:        ${String(successful).padEnd(40)}│`);
  console.log(`│  Failed:            ${String(failed).padEnd(40)}│`);
  console.log(`│  Duration:          ${(overallDuration + "ms").padEnd(40)}│`);
  console.log(`│  Throughput:        ${(throughput + " results/sec").padEnd(40)}│`);
  console.log("├──────────────────────────────────────────────────────────────┤");
  console.log("│  Latency (per request):                                      │");
  console.log(`│    avg:  ${(avg.toFixed(1) + "ms").padEnd(51)}│`);
  console.log(`│    p50:  ${(p50 + "ms").padEnd(51)}│`);
  console.log(`│    p95:  ${(p95 + "ms").padEnd(51)}│`);
  console.log(`│    p99:  ${(p99 + "ms").padEnd(51)}│`);
  console.log("├──────────────────────────────────────────────────────────────┤");
  console.log("│  Status Codes:                                               │");
  Object.entries(statusCodes)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([code, count]) => {
      console.log(`│    HTTP ${code}: ${String(count).padEnd(48)}│`);
    });
  if (failed > 0) {
    const errors = results.filter((r) => r.error).slice(0, 5);
    console.log("├──────────────────────────────────────────────────────────────┤");
    console.log("│  Sample Errors (first 5):                                   │");
    errors.forEach((r) => {
      console.log(`│    ${(r.error || "").substring(0, 56).padEnd(56)}│`);
    });
  }
  console.log("└──────────────────────────────────────────────────────────────┘");
}

main().catch((err) => {
  console.error("Harness failed:", err.message);
  process.exit(1);
});
