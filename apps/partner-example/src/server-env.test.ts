import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readPartnerServerEnv } from "./server-env.ts";

const KEY = `key_0123456789abcdef.${"A".repeat(43)}`;

describe("partner server env", () => {
  it("reads the server key and API URL from non-browser variables", () => {
    assert.deepEqual(readPartnerServerEnv({ CAPITAL_API_URL: "http://127.0.0.1:3000", CAPITAL_API_KEY: KEY }), {
      apiUrl: "http://127.0.0.1:3000",
      apiKey: KEY,
    });
  });

  it("allows demo mode with no CapitalOS URL or key", () => {
    assert.deepEqual(readPartnerServerEnv({}), { apiUrl: undefined, apiKey: undefined });
  });

  it("refuses a CapitalOS URL without a server key", () => {
    assert.throws(
      () => readPartnerServerEnv({ CAPITAL_API_URL: "http://127.0.0.1:3000" }),
      /CAPITAL_API_KEY is required/,
    );
  });

  it("refuses a malformed server key", () => {
    assert.throws(() => readPartnerServerEnv({ CAPITAL_API_KEY: "not-a-key" }), /key_<id>\.<secret>/);
  });

  it("refuses an API key parked in a VITE_ value", () => {
    assert.throws(() => readPartnerServerEnv({ VITE_CAPITAL_API_KEY: KEY }), /never in a VITE_ value/);
  });
});
