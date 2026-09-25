import { getConnInfo } from "@hono/node-server/conninfo";
import { verifyMessageSignatureRsv } from "@stacks/encryption";
import { getAddressFromPublicKey } from "@stacks/transactions";
import {
  type ApiScope,
  findApiKey,
  findClientApp,
  findSession,
  touchSession,
  type KeyPrincipal,
  type PendingNonce,
  type SessionPrincipal,
  type Sql,
} from "@stacks-capital/database";
import type { Context } from "hono";
import { ApiError } from "./errors.ts";
import type { RateLimiter, RateLimits } from "./rateLimit.ts";

// A browser app identified by its publishable client id, calling from one of its allowed origins.
export type ClientPrincipal = { kind: "client"; appId: string; origin: string };
export type Principal = KeyPrincipal | SessionPrincipal | ClientPrincipal;

export const CLIENT_ID_HEADER = "x-capital-client-id";

/** Hard ceiling if unused. Active sessions are extended on each authenticated request. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function authenticate(c: Context, sql: Sql, now: Date): Promise<Principal> {
  const authorization = c.req.header("authorization");
  const origin = c.req.header("origin");

  if (authorization !== undefined) {
    const token = /^Bearer (\S+)$/.exec(authorization)?.[1] ?? "";
    if (token.startsWith("key_")) {
      // Secret keys belong on servers. A browser request carrying one is refused even when the key is valid.
      if (origin !== undefined) throw new ApiError("FORBIDDEN", "API keys must not be used from a browser");
      const key = await findApiKey(sql, token, now);
      if (key !== null) return key;
    } else if (token.startsWith("ses_")) {
      const session = await findSession(sql, token, now);
      if (session !== null) {
        await touchSession(sql, { sessionId: session.sessionId, now, ttlSeconds: SESSION_TTL_SECONDS });
        return session;
      }
    }
    throw new ApiError("UNAUTHORIZED", "Invalid or expired credentials");
  }

  const clientId = c.req.header(CLIENT_ID_HEADER);
  if (clientId === undefined) throw new ApiError("UNAUTHORIZED", "Credentials are required");
  if (origin === undefined) throw new ApiError("UNAUTHORIZED", "A client id is only accepted with an Origin header");
  const app = await findClientApp(sql, clientId);
  if (app === null) throw new ApiError("UNAUTHORIZED", "Unknown client id");
  if (!app.origins.includes(origin)) throw new ApiError("FORBIDDEN", "Origin is not allowed for this client id");
  return { kind: "client", appId: app.appId, origin };
}

export function requireScope(principal: Principal, scope: ApiScope): void {
  if (principal.kind === "key" && !principal.scopes.includes(scope)) {
    throw new ApiError("FORBIDDEN", `API key is missing the ${scope} scope`);
  }
}

export function requireClient(principal: Principal): ClientPrincipal {
  if (principal.kind !== "client") throw new ApiError("FORBIDDEN", "Sign in is started from a partner app");
  return principal;
}

function clientAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function enforceRateLimit(
  c: Context,
  limiter: RateLimiter,
  limits: RateLimits,
  principal: Principal,
  now: Date,
): Promise<void> {
  const [bucket, limit] =
    principal.kind === "key"
      ? [`key:${principal.keyId}`, limits.key]
      : principal.kind === "session"
        ? [`session:${principal.sessionId}`, limits.session]
        : [`client:${principal.appId}:${clientAddress(c)}`, limits.client];

  const decision = await limiter.hit(bucket, limit, limits.windowSeconds, now);
  c.header("ratelimit-limit", String(decision.limit));
  c.header("ratelimit-remaining", String(decision.remaining));
  c.header("ratelimit-reset", String(decision.resetSeconds));
  if (!decision.allowed) {
    c.header("retry-after", String(decision.resetSeconds));
    throw new ApiError("RATE_LIMITED", "Too many requests", decision.resetSeconds);
  }
}

// Accepts a signed sign in message only from the origin it was issued to, for the address it names.
export function signatureMatches(
  nonce: PendingNonce,
  origin: string,
  proof: { publicKey: string; signature: string },
): boolean {
  try {
    return (
      nonce.origin === origin &&
      getAddressFromPublicKey(proof.publicKey, nonce.network) === nonce.address &&
      verifyMessageSignatureRsv({ message: nonce.message, signature: proof.signature, publicKey: proof.publicKey })
    );
  } catch {
    return false;
  }
}
