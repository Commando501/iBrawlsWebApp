import assert from "node:assert/strict";
import test from "node:test";
import { handleAccountRequest, requireSession } from "./accounts";

const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

interface MockSessionRow {
  account_id: string;
  expires_at: number;
}

interface MockDisplayNameRow {
  account_id: string;
  display_name: string;
  normalized_name: string;
  updated_at: number;
}

function makeAccount(overrides: Partial<Record<string, unknown>> = {}) {
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
    ...overrides,
  };
}

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
    return this.db.run(this.sql, this.params);
  }
}

class MockD1Database {
  session: MockSessionRow | null;
  account: ReturnType<typeof makeAccount> | null;
  displayName: MockDisplayNameRow | null;
  cloudSavePayload: string | null;
  accountRowReads = 0;
  displayNameOwnerReads = 0;
  sessionRowWrites = 0;
  registeredDisplayNameRowWrites = 0;
  cloudSaveRowWrites = 0;

  constructor({
    session,
    account,
    displayName,
    cloudSavePayload,
  }: {
    session: MockSessionRow | null;
    account: ReturnType<typeof makeAccount> | null;
    displayName?: MockDisplayNameRow | null;
    cloudSavePayload?: string | null;
  }) {
    this.session = session;
    this.account = account;
    this.displayName = displayName ?? null;
    this.cloudSavePayload = cloudSavePayload ?? null;
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(this, sql);
  }

  async batch(statements: MockStatement[]): Promise<unknown[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  first(sql: string, params: unknown[]): unknown {
    if (sql.includes("FROM sessions WHERE token_hash")) {
      return this.session;
    }
    if (sql.includes("SELECT * FROM accounts WHERE id")) {
      this.accountRowReads += 1;
      return this.account;
    }
    if (sql.includes("SELECT display_name FROM registered_display_names WHERE account_id")) {
      const [accountId] = params;
      return this.displayName?.account_id === accountId
        ? { display_name: this.displayName.display_name }
        : null;
    }
    if (sql.includes("SELECT account_id FROM registered_display_names WHERE normalized_name")) {
      this.displayNameOwnerReads += 1;
      const [normalizedName] = params;
      return this.displayName?.normalized_name.toLowerCase() === String(normalizedName).toLowerCase()
        ? { account_id: this.displayName.account_id }
        : null;
    }
    if (sql.includes("SELECT payload FROM cloud_saves WHERE account_id")) {
      return this.cloudSavePayload ? { payload: this.cloudSavePayload } : null;
    }
    if (sql.includes("SELECT payload, updated_at FROM cloud_saves WHERE account_id")) {
      return this.cloudSavePayload ? { payload: this.cloudSavePayload, updated_at: 1 } : null;
    }
    return null;
  }

  async run(sql: string, params: unknown[]): Promise<{ success: boolean }> {
    if (sql.includes("UPDATE sessions SET expires_at")) {
      this.sessionRowWrites += 1;
      if (this.session) {
        this.session.expires_at = Number(params[0]);
      }
    } else if (sql.includes("INSERT INTO registered_display_names")) {
      const [accountId, displayName, normalizedName, updatedAt] = params;
      const same =
        this.displayName?.account_id === accountId &&
        this.displayName.display_name === displayName &&
        this.displayName.normalized_name === normalizedName;
      if (!same || !sql.includes("WHERE")) {
        this.registeredDisplayNameRowWrites += 1;
        this.displayName = {
          account_id: String(accountId),
          display_name: String(displayName),
          normalized_name: String(normalizedName),
          updated_at: Number(updatedAt),
        };
      }
    } else if (sql.includes("INSERT INTO cloud_saves")) {
      const [, payload] = params;
      const same = this.cloudSavePayload === payload;
      if (!same || !sql.includes("WHERE")) {
        this.cloudSaveRowWrites += 1;
        this.cloudSavePayload = String(payload);
      }
    }
    return { success: true };
  }
}

function authedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer test-token");
  return new Request(`https://example.test${path}`, { ...init, headers });
}

test("requireSession does not rewrite a fresh session on each authenticated request", async (t) => {
  const now = 1_800_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });

  const db = new MockD1Database({
    session: { account_id: "acct-1", expires_at: now + SESSION_TTL_MS - 60_000 },
    account: makeAccount(),
  });

  const account = await requireSession(authedRequest("/api/account/me"), { DB: db as never });

  assert.equal(account?.id, "acct-1");
  assert.equal(db.sessionRowWrites, 0);
});

test("unchanged cloud save PUT does not rewrite session, display name, or save rows", async (t) => {
  const now = 1_800_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });

  const save = {
    version: 3,
    playerName: "ASpence501",
    playerHue: 200,
    adminSettings: {},
  };
  const payload = JSON.stringify(save);
  const db = new MockD1Database({
    session: { account_id: "acct-1", expires_at: now + SESSION_TTL_MS - 60_000 },
    account: makeAccount({ username: "ASpence501" }),
    displayName: {
      account_id: "acct-1",
      display_name: "ASpence501",
      normalized_name: "aspence501",
      updated_at: now - 1_000,
    },
    cloudSavePayload: payload,
  });

  const response = await handleAccountRequest(
    authedRequest("/api/account/save", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }),
    { DB: db as never },
    {},
  );

  assert.equal(response?.status, 200);
  assert.equal(db.sessionRowWrites, 0);
  assert.equal(db.displayNameOwnerReads, 0);
  assert.equal(db.registeredDisplayNameRowWrites, 0);
  assert.equal(db.cloudSaveRowWrites, 0);
});

test("cloud save GET authenticates from the session row without reading the account row", async (t) => {
  const now = 1_800_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });

  const payload = JSON.stringify({ version: 3, playerName: "ASpence501" });
  const db = new MockD1Database({
    session: { account_id: "acct-1", expires_at: now + SESSION_TTL_MS - 60_000 },
    account: makeAccount(),
    cloudSavePayload: payload,
  });

  const response = await handleAccountRequest(
    authedRequest("/api/account/save", { method: "GET" }),
    { DB: db as never },
    {},
  );
  const body = await response?.json() as { save?: { playerName?: string } };

  assert.equal(response?.status, 200);
  assert.equal(body.save?.playerName, "ASpence501");
  assert.equal(db.accountRowReads, 0);
});
