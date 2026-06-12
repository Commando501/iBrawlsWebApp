import assert from "node:assert/strict";
import test from "node:test";
import { handleStatsRequest } from "./stats";

const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

class MockStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: MockD1Database,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): MockStatement {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first(this.sql, this.params) as T | null;
  }

  async run(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

class MockD1Database {
  accountRowReads = 0;

  constructor(
    private readonly now: number,
    private readonly statsPayload: string,
  ) {}

  prepare(sql: string): MockStatement {
    return new MockStatement(this, sql);
  }

  first(sql: string): unknown {
    if (sql.includes("FROM sessions WHERE token_hash")) {
      return { account_id: "acct-1", expires_at: this.now + SESSION_TTL_MS - 60_000 };
    }
    if (sql.includes("SELECT * FROM accounts WHERE id")) {
      this.accountRowReads += 1;
      return {
        id: "acct-1",
        email: "pilot@example.com",
        username: "Pilot",
        password_hash: "hash",
        password_salt: "salt",
        recovery_code: "1234",
        created_at: 1,
        username_changed_at: null,
        email_changed_at: null,
        password_changed_at: null,
        recovery_fail_count: 0,
        recovery_locked_until: null,
        is_admin: 0,
      };
    }
    if (sql.includes("FROM player_stats WHERE account_id")) {
      return { payload: this.statsPayload, updated_at: 1 };
    }
    return null;
  }
}

function authedRequest(path: string): Request {
  return new Request(`https://example.test${path}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

test("stats GET authenticates from the session row without reading the account row", async (t) => {
  const now = 1_800_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });

  const db = new MockD1Database(
    now,
    JSON.stringify({ totals: { "combat.kills": 3 }, modes: {} }),
  );

  const response = await handleStatsRequest(
    authedRequest("/api/account/stats"),
    { DB: db as never },
    {},
  );
  const body = await response?.json() as { stats?: { totals?: Record<string, number> } };

  assert.equal(response?.status, 200);
  assert.equal(body.stats?.totals?.["combat.kills"], 3);
  assert.equal(db.accountRowReads, 0);
});
