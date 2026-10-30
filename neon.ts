import { defineConfig } from "@neon/config/v1";

/**
 * Neon services for the Connect Vaquejada migration.
 * Run `neon config plan` before applying this configuration to a linked project.
 */
export default defineConfig({
  auth: true,
  dataApi: true,
});
