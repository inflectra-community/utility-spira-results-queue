/**
 * Represents a single automated test run result, matching the Spira
 * RemoteAutomatedTestRun object structure.
 */
export interface RemoteAutomatedTestRun {
  TestCaseId: number;
  ReleaseId?: number | null;
  TestSetId?: number | null;
  TestSetTestCaseId?: number | null;
  ExecutionStatusId: number;
  TestRunFormatId: number;
  StartDate: string;
  EndDate: string;
  RunnerName: string;
  RunnerTestName: string;
  RunnerMessage?: string | null;
  RunnerStackTrace?: string | null;
  AutomationHostId?: number | null;
  Parameters?: Record<string, string> | null;
  [key: string]: unknown;
}

/**
 * The message envelope published to RabbitMQ.
 */
export interface QueueMessage {
  /** Unique message ID for tracing */
  id: string;
  /** ISO timestamp when the message was enqueued */
  enqueuedAt: string;
  /** The Spira project ID the results belong to */
  projectId: number;
  /** Which endpoint to call on the real Spira (single or bulk) */
  endpoint: "record" | "record-multiple";
  /** The payload — one or more test run results */
  payload: RemoteAutomatedTestRun | RemoteAutomatedTestRun[];
  /** Number of delivery attempts so far */
  attempts: number;
}

/**
 * Execution statuses in Spira.
 */
export enum ExecutionStatus {
  Failed = 1,
  Passed = 2,
  NotRun = 3,
  NotApplicable = 4,
  Blocked = 5,
  Caution = 6,
}
