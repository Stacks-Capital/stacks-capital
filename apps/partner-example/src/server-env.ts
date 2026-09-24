type Env = Record<string, string | undefined>;

const SECRET_VALUE = /^(key|ses)_[a-f0-9]{16}\./;
const SERVER_KEY = /^key_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/;

export type PartnerServerEnv = {
  apiUrl: string | undefined;
  apiKey: string | undefined;
};

/**
 * Server-only secrets for the partner host. Browser `VITE_` values are refused if they
 * look like a CapitalOS API key or session token.
 */
export function readPartnerServerEnv(env: Env = process.env): PartnerServerEnv {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_") || value === undefined) continue;
    if (SECRET_VALUE.test(value)) {
      throw new Error(`${name} holds a secret. API keys belong in the root .env.local, never in a VITE_ value.`);
    }
  }

  const apiUrl = emptyToUndefined(env.CAPITAL_API_URL);
  const apiKey = emptyToUndefined(env.CAPITAL_API_KEY);
  if (apiKey !== undefined && !SERVER_KEY.test(apiKey)) {
    throw new Error("CAPITAL_API_KEY must be a CapitalOS server token (key_<id>.<secret>).");
  }
  if (apiUrl !== undefined && apiKey === undefined) {
    throw new Error("CAPITAL_API_KEY is required when CAPITAL_API_URL points at the CapitalOS API.");
  }

  return { apiUrl, apiKey };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}
