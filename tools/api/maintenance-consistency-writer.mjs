/**
 * Test-only independent writer process. It uses only the public maintenance
 * facade and a fake fetch, so the parent test can verify consistent reads
 * while attempts transition from queued to completed in another process.
 */
import { renameSync, writeFileSync } from "node:fs";

import { loadMaintenanceModules } from "./maintenance-fixtures.mjs";

const [databasePath, countText, donePath] = process.argv.slice(2);
const count = Number(countText);
const modules = await loadMaintenanceModules();

globalThis.fetch = async (_input, init) => {
  const requestBody = JSON.parse(String(init.body));
  const results = requestBody.group_ids.map((groupId) => ({
    bot_id: "consistency-bot",
    error: null,
    error_code: null,
    group_id: groupId,
    status: "success",
    success: true,
  }));

  return new Response(JSON.stringify({ results }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
};

const maintenance = modules.service.createMaintenanceService({
  databasePath,
  upstream: {
    apiOrigin: "http://127.0.0.1:1",
    bearerToken: "consistency-synthetic-token",
  },
});

let processed = 0;

try {
  while (processed < count) {
    const result = await maintenance.runOnce();

    if (!result.processed) {
      break;
    }

    processed += 1;
    await new Promise((resolve) => {
      setTimeout(resolve, 2);
    });
  }

  const payload = {
    expected: count,
    ok: processed === count,
    processed,
  };
  writeFileSync(`${donePath}.tmp`, JSON.stringify(payload));
  renameSync(`${donePath}.tmp`, donePath);
  process.exitCode = processed === count ? 0 : 3;
} catch (error) {
  writeFileSync(
    donePath,
    JSON.stringify({
      error: error instanceof Error ? error.stack : String(error),
      ok: false,
      processed,
    }),
  );
  process.exitCode = 1;
}
