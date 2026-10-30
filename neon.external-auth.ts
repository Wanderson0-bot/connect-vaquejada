import { defineConfig } from "@neon/config/v1";

const jwksUrl = process.env.BETTER_AUTH_JWKS_URL?.trim();
const jwtAudience = process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "");
if (!jwksUrl || !jwtAudience) {
  throw new Error("Set BETTER_AUTH_JWKS_URL and BETTER_AUTH_URL before planning the external-auth Data API on a new Neon branch.");
}

/**
 * Use only when enabling Data API for the first time on a fresh staging branch.
 * Neon does not allow changing the Data API JWT provider after it is enabled.
 * The default neon.ts intentionally remains unchanged for existing branches.
 */
export default defineConfig({
  dataApi: {
    authProvider: "external",
    jwksUrl,
    providerName: "Connect Better Auth",
    jwtAudience,
  },
});
