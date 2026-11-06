import { Pool } from "pg";
import { loadConfig } from "../src/config.js";

interface SeedLog {
  id: string;
  service: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
  timestamp: string;
}

/** Deterministic UUID so re-seeding is a no-op instead of duplicating rows. */
function seedId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// Fixed window (2026-11-01, UTC day) so README demo commands (from/to, filters,
// analyze) always return the same rows regardless of when the seed runs.
// Timestamps mix UTC and -03:00 offsets on purpose to exercise the UTC
// normalization documented in ARCHITECTURE.md §3.
const SEED_LOGS: SeedLog[] = [
  // payments-api: a connection-errors cluster + recovery + happy path
  { id: seedId(1), service: "payments-api", level: "ERROR", message: "Connection refused to database at 10.0.1.5:5432", timestamp: "2026-11-01T08:00:01Z" },
  { id: seedId(2), service: "payments-api", level: "ERROR", message: "Connection refused to database at 10.0.1.5:5432", timestamp: "2026-11-01T08:00:04Z" },
  { id: seedId(3), service: "payments-api", level: "ERROR", message: "Connection refused to database at 10.0.1.5:5432", timestamp: "2026-11-01T08:00:09Z" },
  { id: seedId(4), service: "payments-api", level: "WARN", message: "Retrying payment capture after 500ms", timestamp: "2026-11-01T08:00:10Z" },
  { id: seedId(5), service: "payments-api", level: "WARN", message: "Retrying payment capture after 500ms", timestamp: "2026-11-01T08:00:12Z" },
  { id: seedId(6), service: "payments-api", level: "INFO", message: "Payment captured successfully for order ord_4821", timestamp: "2026-11-01T08:00:15Z" },
  { id: seedId(7), service: "payments-api", level: "INFO", message: "Payment captured successfully for order ord_4822", timestamp: "2026-11-01T08:05:00-03:00" },
  { id: seedId(8), service: "payments-api", level: "INFO", message: "Payment captured successfully for order ord_4823", timestamp: "2026-11-01T08:10:00-03:00" },
  { id: seedId(9), service: "payments-api", level: "DEBUG", message: "Idempotency key cache hit for order ord_4823", timestamp: "2026-11-01T08:10:01-03:00" },

  // auth-service: upstream timeouts + rate limiting + normal traffic
  { id: seedId(10), service: "auth-service", level: "ERROR", message: "Timeout waiting for upstream identity provider after 5000ms", timestamp: "2026-11-01T09:00:00Z" },
  { id: seedId(11), service: "auth-service", level: "ERROR", message: "Timeout waiting for upstream identity provider after 5000ms", timestamp: "2026-11-01T09:01:30Z" },
  { id: seedId(12), service: "auth-service", level: "WARN", message: "Rate limit approaching for client 198.51.100.23", timestamp: "2026-11-01T09:02:00Z" },
  { id: seedId(13), service: "auth-service", level: "WARN", message: "Rate limit approaching for client 198.51.100.23", timestamp: "2026-11-01T09:03:00Z" },
  { id: seedId(14), service: "auth-service", level: "INFO", message: "User authenticated successfully (user_id=9001)", timestamp: "2026-11-01T09:04:00Z" },
  { id: seedId(15), service: "auth-service", level: "INFO", message: "User authenticated successfully (user_id=9002)", timestamp: "2026-11-01T09:04:30Z" },
  { id: seedId(16), service: "auth-service", level: "INFO", message: "User authenticated successfully (user_id=9003)", timestamp: "2026-11-01T09:05:00Z" },
  { id: seedId(17), service: "auth-service", level: "DEBUG", message: "Token cache hit for session sess_abc123", timestamp: "2026-11-01T09:05:01Z" },
  { id: seedId(18), service: "auth-service", level: "DEBUG", message: "Token cache hit for session sess_abc456", timestamp: "2026-11-01T09:05:05Z" },

  // notifications-worker: SMTP failures + normal queueing
  { id: seedId(19), service: "notifications-worker", level: "ERROR", message: "Failed to deliver email: SMTP connection refused", timestamp: "2026-11-01T10:00:00Z" },
  { id: seedId(20), service: "notifications-worker", level: "ERROR", message: "Failed to deliver email: SMTP connection refused", timestamp: "2026-11-01T10:00:45Z" },
  { id: seedId(21), service: "notifications-worker", level: "INFO", message: "Notification queued for user_id=9001", timestamp: "2026-11-01T10:01:00Z" },
  { id: seedId(22), service: "notifications-worker", level: "INFO", message: "Notification queued for user_id=9002", timestamp: "2026-11-01T10:01:10Z" },
  { id: seedId(23), service: "notifications-worker", level: "INFO", message: "Notification queued for user_id=9003", timestamp: "2026-11-01T10:01:20Z" },

  // orders-api: validation failures + slow validation warning + normal path
  { id: seedId(24), service: "orders-api", level: "WARN", message: "Order validation took 1200ms, exceeding the 1000ms threshold", timestamp: "2026-11-01T11:00:00Z" },
  { id: seedId(25), service: "orders-api", level: "ERROR", message: "Validation failed: missing required field 'shippingAddress'", timestamp: "2026-11-01T11:00:30Z" },
  { id: seedId(26), service: "orders-api", level: "ERROR", message: "Validation failed: missing required field 'shippingAddress'", timestamp: "2026-11-01T11:01:00Z" },
  { id: seedId(27), service: "orders-api", level: "INFO", message: "Order created (order_id=ord_4824)", timestamp: "2026-11-01T11:02:00Z" },
  { id: seedId(28), service: "orders-api", level: "INFO", message: "Order created (order_id=ord_4825)", timestamp: "2026-11-01T11:03:00Z" },
  { id: seedId(29), service: "orders-api", level: "INFO", message: "Order created (order_id=ord_4826)", timestamp: "2026-11-01T11:04:00Z" },
];

/**
 * Idempotent by construction: every row uses a deterministic id (seedId) and
 * is inserted with ON CONFLICT DO NOTHING, so running this against an
 * already-seeded database inserts zero rows instead of duplicating them.
 */
export async function seedDatabase(pool: Pool): Promise<{ inserted: number; alreadyPresent: number }> {
  let inserted = 0;
  for (const log of SEED_LOGS) {
    const result = await pool.query(
      `INSERT INTO logs (id, service, level, message, "timestamp")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [log.id, log.service, log.level, log.message, log.timestamp],
    );
    inserted += result.rowCount ?? 0;
  }
  return { inserted, alreadyPresent: SEED_LOGS.length - inserted };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const { inserted, alreadyPresent } = await seedDatabase(pool);
    console.log(`Seed complete: ${inserted} inserted, ${alreadyPresent} already present.`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
