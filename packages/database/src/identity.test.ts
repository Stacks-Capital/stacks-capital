import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { FIXTURE_APP, FIXTURE_WORKFLOW_ID, OTHER_APP, seedFixtures } from "./fixtures.ts";
import {
  createApiKey,
  createNonce,
  exchangeNonceForSession,
  findApiKey,
  findClientApp,
  findSession,
  findWorkflowForTenant,
  touchSession,
  isAllowedOrigin,
  revokeApiKey,
} from "./identity.ts";
import { connect, MIGRATIONS_DIR, migrate, type Sql } from "./lib.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const NOW = new Date("2026-09-15T12:00:00.000Z");
const ADDRESS = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe("identity", { skip: DATABASE_URL === "" ? "DATABASE_URL is not set" : false }, () => {
  const admin = connect(DATABASE_URL);
  const schema = `test_${randomBytes(6).toString("hex")}`;
  let sql: Sql;

  before(async () => {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = connect(DATABASE_URL, schema);
    await migrate(sql, MIGRATIONS_DIR);
    await seedFixtures(sql);
  });

  after(async () => {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const nonce = (appId: string, origin: string) =>
    createNonce(sql, { appId, origin, address: ADDRESS, network: "mainnet", now: NOW, ttlSeconds: 300 });
  const exchange = (nonceId: string, accept: boolean, now = NOW) =>
    exchangeNonceForSession(sql, { nonceId, appId: FIXTURE_APP.id, now, ttlSeconds: 3600, accept: () => accept });

  describe("client apps", () => {
    it("resolve a publishable client id to its app and allowed origins", async () => {
      assert.deepEqual(await findClientApp(sql, FIXTURE_APP.clientId), {
        appId: FIXTURE_APP.id,
        origins: [...FIXTURE_APP.origins],
      });
      assert.equal(await findClientApp(sql, "pk_unknown"), null);
    });

    it("treat disabled apps as unknown", async () => {
      await sql`UPDATE partner_apps SET disabled_at = ${NOW} WHERE id = ${OTHER_APP.id}`;
      assert.equal(await findClientApp(sql, OTHER_APP.clientId), null);
      assert.equal(await isAllowedOrigin(sql, OTHER_APP.origin), false);
      assert.equal(await isAllowedOrigin(sql, FIXTURE_APP.origin), true);
      await sql`UPDATE partner_apps SET disabled_at = NULL WHERE id = ${OTHER_APP.id}`;
    });
  });

  describe("API keys", () => {
    it("authenticate with their scopes and store only a hash", async () => {
      const { keyId, token } = await createApiKey(sql, { appId: FIXTURE_APP.id, scopes: ["markets:read"] });
      assert.deepEqual(await findApiKey(sql, token, NOW), {
        kind: "key",
        appId: FIXTURE_APP.id,
        keyId,
        scopes: ["markets:read"],
      });
      const secret = token.split(".")[1] ?? "";
      const [row] = await sql<{ stored: string }[]>`SELECT secret_hash AS stored FROM api_keys WHERE id = ${keyId}`;
      assert.ok(row !== undefined && !row.stored.includes(secret) && row.stored !== token);
    });

    it("reject a wrong secret, a malformed token, a revoked key and an expired key", async () => {
      const { keyId, token } = await createApiKey(sql, { appId: FIXTURE_APP.id, scopes: ["markets:read"] });
      assert.equal(await findApiKey(sql, `${keyId}.${"A".repeat(43)}`, NOW), null);
      assert.equal(await findApiKey(sql, "key_nothex.secret", NOW), null);
      await revokeApiKey(sql, keyId, NOW);
      assert.equal(await findApiKey(sql, token, NOW), null);

      const expiring = await createApiKey(sql, {
        appId: FIXTURE_APP.id,
        scopes: ["markets:read"],
        expiresAt: later(60),
      });
      assert.notEqual(await findApiKey(sql, expiring.token, NOW), null);
      assert.equal(await findApiKey(sql, expiring.token, later(61)), null);
    });

    it("can be created as the first query on a fresh connection, as a command line tool does", async () => {
      const cold = connect(DATABASE_URL, schema);
      try {
        const { token } = await createApiKey(cold, { appId: FIXTURE_APP.id, scopes: ["markets:read", "quotes:write"] });
        assert.deepEqual((await findApiKey(sql, token, NOW))?.scopes, ["markets:read", "quotes:write"]);
      } finally {
        await cold.end();
      }
    });

    it("refuse scopes outside the contract", async () => {
      await assert.rejects(
        sql`INSERT INTO api_keys (id, app_id, secret_hash, scopes)
            VALUES ('key_0000000000000000', ${FIXTURE_APP.id}, ${"0".repeat(64)}, ARRAY['admin:all']::text[]::api_scope[])`,
        (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23514",
      );
    });
  });

  describe("sign in nonces and sessions", () => {
    it("bind the message to the origin, network and nonce", async () => {
      const created = await nonce(FIXTURE_APP.id, FIXTURE_APP.origin);
      for (const part of [ADDRESS, `Origin: ${FIXTURE_APP.origin}`, "Network: mainnet", `Nonce: ${created.nonceId}`]) {
        assert.ok(created.message.includes(part), part);
      }
    });

    it("refuse an origin the app does not allow", async () => {
      await assert.rejects(nonce(FIXTURE_APP.id, OTHER_APP.origin));
    });

    it("exchange a nonce for a session exactly once", async () => {
      const { nonceId } = await nonce(FIXTURE_APP.id, FIXTURE_APP.origin);
      const session = await exchange(nonceId, true);
      assert.ok(session !== null);
      assert.deepEqual(await findSession(sql, session.token, NOW), {
        kind: "session",
        appId: FIXTURE_APP.id,
        sessionId: session.sessionId,
        address: ADDRESS,
        network: "mainnet",
      });
      assert.equal(await exchange(nonceId, true), null);
    });

    it("burn a nonce on a rejected signature", async () => {
      const { nonceId } = await nonce(FIXTURE_APP.id, FIXTURE_APP.origin);
      assert.equal(await exchange(nonceId, false), null);
      assert.equal(await exchange(nonceId, true), null);
    });

    it("reject an expired nonce, a nonce from another app and an expired session", async () => {
      const expired = await nonce(FIXTURE_APP.id, FIXTURE_APP.origin);
      assert.equal(await exchange(expired.nonceId, true, later(301)), null);

      const foreign = await nonce(OTHER_APP.id, OTHER_APP.origin);
      assert.equal(await exchange(foreign.nonceId, true), null);

      const { nonceId } = await nonce(FIXTURE_APP.id, FIXTURE_APP.origin);
      const session = await exchange(nonceId, true);
      assert.ok(session !== null);
      assert.equal(await findSession(sql, session.token, later(3601)), null);
      assert.equal(await findSession(sql, `${session.sessionId}.${"A".repeat(43)}`, NOW), null);
    });

    it("extends an active session so it does not die on the original wall-clock expiry", async () => {
      const { nonceId } = await nonce(FIXTURE_APP.id, FIXTURE_APP.origin);
      const session = await exchange(nonceId, true);
      assert.ok(session !== null);
      await touchSession(sql, { sessionId: session.sessionId, now: later(3500), ttlSeconds: 3600 });
      assert.notEqual(await findSession(sql, session.token, later(3601)), null);
    });
  });

  describe("workflow reads", () => {
    it("return the workflow to its own tenant with its transitions", async () => {
      const workflow = await findWorkflowForTenant(sql, {
        id: FIXTURE_WORKFLOW_ID,
        appId: FIXTURE_APP.id,
        ownerAddress: null,
      });
      assert.equal(workflow?.state, "CONFIRMING");
      assert.deepEqual(
        workflow?.transitions.map((move) => move.to),
        ["QUOTED", "AWAITING_SIGNATURE", "SUBMITTED", "CONFIRMING"],
      );
    });

    it("hide the workflow from another tenant and from another owner", async () => {
      assert.equal(
        await findWorkflowForTenant(sql, { id: FIXTURE_WORKFLOW_ID, appId: OTHER_APP.id, ownerAddress: null }),
        null,
      );
      assert.equal(
        await findWorkflowForTenant(sql, {
          id: FIXTURE_WORKFLOW_ID,
          appId: FIXTURE_APP.id,
          ownerAddress: "SP_SOMEONE_ELSE",
        }),
        null,
      );
      assert.notEqual(
        await findWorkflowForTenant(sql, { id: FIXTURE_WORKFLOW_ID, appId: FIXTURE_APP.id, ownerAddress: ADDRESS }),
        null,
      );
    });
  });
});
