/**
 * PM2 Ecosystem Configuration
 *
 * Use PM2 to manage the gateway and worker as production services:
 *   pm2 start ecosystem.config.js
 *   pm2 status
 *   pm2 logs
 *   pm2 restart all
 *   pm2 stop all
 *
 * PM2 provides:
 *  - Automatic restarts on crash
 *  - Log management and rotation
 *  - Cluster mode for the gateway (scale horizontally)
 *  - Startup script generation (survives reboots)
 *  - Monitoring via pm2 monit / pm2 plus
 */
module.exports = {
  apps: [
    {
      name: "spira-queue-gateway",
      script: "dist/gateway/server.js",
      instances: 1, // Increase for multi-core (or use "max" for cluster)
      exec_mode: "fork", // Use "cluster" if instances > 1
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      // Graceful shutdown timeout (ms) — allows in-flight requests to complete
      kill_timeout: 5000,
      // Wait this long before considering the app "online"
      wait_ready: false,
      // Restart delay on crash (ms)
      restart_delay: 2000,
      // Max restarts within a window before stopping
      max_restarts: 10,
      min_uptime: "10s",
      // Log configuration
      error_file: "logs/gateway-error.log",
      out_file: "logs/gateway-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
    },
    {
      name: "spira-queue-worker",
      script: "dist/worker/worker.js",
      instances: 1, // Scale workers for higher throughput (each respects WORKER_CONCURRENCY)
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      kill_timeout: 10000, // Workers need longer to finish processing in-flight messages
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      error_file: "logs/worker-error.log",
      out_file: "logs/worker-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
    },
  ],
};
