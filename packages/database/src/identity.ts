import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "./lib.ts";
import type { NetworkName } from "./registry.ts";

// Same values as the api_scope domain in 0006_identity.sql.
export const API_SCOPES = [
  "markets:read",
  "positions:read",
  "quotes:write",
  "workflows:write",
  "webhooks:manage",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export type ClientApp = { appId: string; origins: string[] };
export type KeyPrincipal = { kind: "key"; appId: string; keyId: string; scopes: ApiScope[] };
export type SessionPrincipal = {
  kind: "session";
  appId: string;
  sessionId: string;
  address: string;
  network: NetworkName;
};
export type PendingNonce = { address: string; network: NetworkName; origin: string; message: string };

export type WorkflowRecord = {
  id: string;
  network: NetworkName;
  state: string;
  nextAction: string;
  quoteId: string | null;
  planId: string | null;
  action: string | null;
  ownerAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  transitions: {
    sequence: number;
    from: string;
    to: string;
    reason: string;
    actor: string;
    evidence: string;
    at: string;
  }[];
  attempts: {
    stepId: string;
    chain: "bitcoin" | "stacks";
    outcome: "BROADCAST" | "SIGNED" | "UNKNOWN";
    txid: string | null;
    recordedAt: string;
  }[];
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const newSecret = (): string => randomBytes(32).toString("base64url");

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Tokens are "<id>.<secret>". The id finds the row; the secret is compared by hash in constant time.
function splitToken(token: string, id: RegExp): { id: string; secret: string } | null {
  const [head, secret, extra] = token.split(".");
  if (head === undefined || secret === undefined || extra !== undefined) return null;
  if (!id.test(head) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id: head, secret };
}

export async function findClientApp(sql: Sql, clientId: string): Promise<ClientApp | null> {
  const [row] = await sql<ClientApp[]>`
    SELECT a.id AS "appId",
           coalesce(array_agg(o.origin ORDER BY o.origin) FILTER (WHERE o.origin IS NOT NULL), '{}') AS origins
    FROM partner_apps a
    LEFT JOIN allowed_origins o ON o.app_id = a.id
    WHERE a.client_id = ${clientId} AND a.disabled_at IS NULL
    GROUP BY a.id
  `;
  return row ?? null;
}

// Used for CORS preflight, which carries no credentials: any enabled app allowing the origin is enough there.
export async function isAllowedOrigin(sql: Sql, origin: string): Promise<boolean> {
  const [row] = await sql<{ allowed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM allowed_origins o JOIN partner_apps a ON a.id = o.app_id
      WHERE o.origin = ${origin} AND a.disabled_at IS NULL
    ) AS allowed
  `;
  return row?.allowed === true;
}

export async function createApiKey(
  sql: Sql,
  input: { appId: string; scopes: ApiScope[]; expiresAt?: Date },
): Promise<{ keyId: string; token: string }> {
  const keyId = `key_${randomBytes(8).toString("hex")}`;
  const secret = newSecret();
  // Sent as an array literal rather than through sql.array, which needs the driver to have learned the
  // array types first and fails when this is the first query on a connection (a command line tool).
  const unknown = input.scopes.filter((scope) => !(API_SCOPES as readonly string[]).includes(scope));
  if (unknown.length > 0) throw new Error(`Unknown scopes: ${unknown.join(", ")}`);
  const scopes = `{${input.scopes.join(",")}}`;
  await sql`
    INSERT INTO api_keys (id, app_id, secret_hash, scopes, expires_at)
    VALUES (${keyId}, ${input.appId}, ${sha256(secret)}, ${scopes}::api_scope[], ${input.expiresAt ?? null})
  `;
  return { keyId, token: `${keyId}.${secret}` };
}

export async function revokeApiKey(sql: Sql, keyId: string, now: Date): Promise<void> {
  await sql`UPDATE api_keys SET revoked_at = ${now} WHERE id = ${keyId} AND revoked_at IS NULL`;
}

export async function findApiKey(sql: Sql, token: string, now: Date): Promise<KeyPrincipal | null> {
  const parts = splitToken(token, /^key_[a-f0-9]{16}$/);
  if (parts === null) return null;
  const [row] = await sql<{ appId: string; secretHash: string; scopes: ApiScope[] }[]>`
    SELECT k.app_id AS "appId", k.secret_hash AS "secretHash", k.scopes::text[] AS scopes
    FROM api_keys k
    JOIN partner_apps a ON a.id = k.app_id
    WHERE k.id = ${parts.id}
      AND k.revoked_at IS NULL
      AND (k.expires_at IS NULL OR k.expires_at > ${now})
      AND a.disabled_at IS NULL
  `;
  if (row === undefined || !sameHash(row.secretHash, sha256(parts.secret))) return null;
  return { kind: "key", appId: row.appId, keyId: parts.id, scopes: row.scopes };
}

export async function createNonce(
  sql: Sql,
  input: { appId: string; origin: string; address: string; network: NetworkName; now: Date; ttlSeconds: number },
): Promise<{ nonceId: string; message: string; expiresAt: Date }> {
  const nonceId = `non_${randomBytes(16).toString("hex")}`;
  const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
  const message = [
    "Stacks Capital wants you to sign in with your Stacks account:",
    input.address,
    "",
    `Origin: ${input.origin}`,
    `Network: ${input.network}`,
    `Nonce: ${nonceId}`,
    `Issued At: ${input.now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
  await sql`
    INSERT INTO auth_nonces (id, app_id, origin, address, network, message, created_at, expires_at)
    VALUES (${nonceId}, ${input.appId}, ${input.origin}, ${input.address}, ${input.network}, ${message}, ${input.now}, ${expiresAt})
  `;
  return { nonceId, message, expiresAt };
}

// A nonce is spent on the first attempt, valid or not, so a signature can never be tried twice.
export async function exchangeNonceForSession(
  sql: Sql,
  input: { nonceId: string; appId: string; now: Date; ttlSeconds: number; accept: (nonce: PendingNonce) => boolean },
): Promise<{ token: string; sessionId: string; address: string; network: NetworkName; expiresAt: Date } | null> {
  return sql.begin(async (tx) => {
    const [nonce] = await tx<(PendingNonce & { usedAt: Date | null; expiresAt: Date })[]>`
      SELECT address, network, origin, message, used_at AS "usedAt", expires_at AS "expiresAt"
      FROM auth_nonces
      WHERE id = ${input.nonceId} AND app_id = ${input.appId}
      FOR UPDATE
    `;
    if (nonce === undefined || nonce.usedAt !== null || nonce.expiresAt <= input.now) return null;
    await tx`UPDATE auth_nonces SET used_at = ${input.now} WHERE id = ${input.nonceId}`;
    if (!input.accept(nonce)) return null;

    const sessionId = `ses_${randomBytes(8).toString("hex")}`;
    const secret = newSecret();
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    await tx`
      INSERT INTO user_sessions (id, app_id, address, network, nonce_id, secret_hash, created_at, expires_at)
      VALUES (${sessionId}, ${input.appId}, ${nonce.address}, ${nonce.network}, ${input.nonceId}, ${sha256(secret)},
              ${input.now}, ${expiresAt})
    `;
    return { token: `${sessionId}.${secret}`, sessionId, address: nonce.address, network: nonce.network, expiresAt };
  });
}

export async function findSession(sql: Sql, token: string, now: Date): Promise<SessionPrincipal | null> {
  const parts = splitToken(token, /^ses_[a-f0-9]{16}$/);
  if (parts === null) return null;
  const [row] = await sql<{ appId: string; secretHash: string; address: string; network: NetworkName }[]>`
    SELECT s.app_id AS "appId", s.secret_hash AS "secretHash", s.address, s.network
    FROM user_sessions s
    JOIN partner_apps a ON a.id = s.app_id
    WHERE s.id = ${parts.id} AND s.revoked_at IS NULL AND s.expires_at > ${now} AND a.disabled_at IS NULL
  `;
  if (row === undefined || !sameHash(row.secretHash, sha256(parts.secret))) return null;
  return { kind: "session", appId: row.appId, sessionId: parts.id, address: row.address, network: row.network };
}

/** Sliding expiry so an active wallet session does not die on a hard wall-clock TTL. */
export async function touchSession(
  sql: Sql,
  input: { sessionId: string; now: Date; ttlSeconds: number },
): Promise<void> {
  const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
  await sql`
    UPDATE user_sessions
    SET expires_at = ${expiresAt}
    WHERE id = ${input.sessionId} AND revoked_at IS NULL
  `;
}

// Tenant filtering happens in the query, so another tenant's workflow looks exactly like a missing one.
export async function findWorkflowForTenant(
  sql: Sql,
  input: { id: string; appId: string; ownerAddress: string | null },
): Promise<WorkflowRecord | null> {
  const [row] = await sql<WorkflowRecord[]>`
    SELECT w.id,
           w.network,
           w.state,
           w.next_action AS "nextAction",
           w.quote_id AS "quoteId",
           w.plan_id AS "planId",
           q.action,
           w.owner_address AS "ownerAddress",
           w.created_at AS "createdAt",
           w.updated_at AS "updatedAt",
           coalesce(
             (SELECT json_agg(
                       json_build_object(
                         'sequence', t.sequence, 'from', t.from_state, 'to', t.to_state, 'reason', t.reason,
                         'actor', t.actor, 'evidence', t.evidence, 'at', t.at
                       ) ORDER BY t.sequence)
              FROM state_transitions t WHERE t.workflow_id = w.id),
             '[]'
           ) AS transitions,
           coalesce(
             (SELECT json_agg(
                       json_build_object(
                         'stepId', substr(a.step_id, char_length(w.id) + 2),
                         'chain', a.chain, 'outcome', a.outcome, 'txid', a.txid,
                         'recordedAt', a.recorded_at
                       ) ORDER BY a.id)
              FROM transaction_attempts a WHERE a.workflow_id = w.id),
             '[]'
           ) AS attempts
    FROM workflows w
    LEFT JOIN quotes q ON q.id = w.quote_id AND q.network = w.network
    WHERE w.id = ${input.id}
      AND w.app_id = ${input.appId}
      AND (${input.ownerAddress}::text IS NULL OR w.owner_address = ${input.ownerAddress}::text)
  `;
  return row ?? null;
}

export type WorkflowSummary = {
  id: string;
  network: NetworkName;
  state: string;
  nextAction: string;
  quoteId: string | null;
  planId: string | null;
  action: string | null;
  createdAt: Date;
  updatedAt: Date;
  transitionCount: number;
  lastTxid: string | null;
};

/** A tenant's workflows, newest first. The same tenant filter as a single read, applied in the query. */
export async function listWorkflowsForTenant(
  sql: Sql,
  input: {
    appId: string;
    ownerAddress: string | null;
    network: NetworkName;
    limit: number;
    /** Keyset on both the time and the id, so workflows created in the same instant are never skipped. */
    before?: { createdAt: Date; id: string } | undefined;
  },
): Promise<{ items: WorkflowSummary[]; hasMore: boolean }> {
  const rows = await sql<WorkflowSummary[]>`
    SELECT w.id, w.network, w.state, w.next_action AS "nextAction", w.quote_id AS "quoteId", w.plan_id AS "planId",
           q.action,
           w.created_at AS "createdAt", w.updated_at AS "updatedAt",
           (SELECT count(*)::int FROM state_transitions t WHERE t.workflow_id = w.id) AS "transitionCount",
           (SELECT a.txid FROM transaction_attempts a
             WHERE a.workflow_id = w.id AND a.txid IS NOT NULL
             ORDER BY a.id DESC LIMIT 1) AS "lastTxid"
    FROM workflows w
    LEFT JOIN quotes q ON q.id = w.quote_id AND q.network = w.network
    WHERE w.app_id = ${input.appId}
      AND w.network = ${input.network}
      AND (${input.ownerAddress}::text IS NULL OR w.owner_address = ${input.ownerAddress}::text)
      AND (
        ${input.before?.createdAt ?? null}::timestamptz IS NULL
        OR (w.created_at, w.id) < (${input.before?.createdAt ?? null}::timestamptz, ${input.before?.id ?? null}::text)
      )
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT ${input.limit + 1}
  `;
  return { items: rows.slice(0, input.limit), hasMore: rows.length > input.limit };
}
