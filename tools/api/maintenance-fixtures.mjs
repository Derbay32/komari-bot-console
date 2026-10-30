import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAuthModuleUrls } from "./auth-fixtures.mjs";
import { loadTypeScriptModule } from "./typescript-modules.mjs";

export const TEST_BACKEND_TOKEN = "maintenance-synthetic-bearer-token";

const builtinImports = {
  "node:crypto": "node:crypto",
  "node:fs": "node:fs",
  "node:http": "node:http",
  "node:path": "node:path",
  "node:sqlite": "node:sqlite",
};

export async function loadMaintenanceModules() {
  const libUrl = loadTypeScriptModule("src/lib/maintenance.ts");
  const auditUrl = loadTypeScriptModule("src/lib/http/audit.ts");
  const databaseUrl = loadTypeScriptModule(
    "src/lib/server/database.ts",
    builtinImports,
  );
  const schemaUrl = loadTypeScriptModule(
    "src/lib/server/maintenance/schema.ts",
    builtinImports,
  );
  const transportUrl = loadTypeScriptModule(
    "src/lib/server/maintenance/transport.ts",
    {
      ...builtinImports,
      "../../http/audit": auditUrl,
      "../../maintenance": libUrl,
    },
  );
  const storageUrl = loadTypeScriptModule(
    "src/lib/server/maintenance/storage.ts",
    {
      ...builtinImports,
      "../../http/audit": auditUrl,
      "../../maintenance": libUrl,
      "../database": databaseUrl,
      "./schema": schemaUrl,
    },
  );
  const serviceUrl = loadTypeScriptModule(
    "src/lib/server/maintenance/service.ts",
    {
      ...builtinImports,
      "../../maintenance": libUrl,
      "./schema": schemaUrl,
      "./storage": storageUrl,
      "./transport": transportUrl,
    },
  );
  const indexUrl = loadTypeScriptModule(
    "src/lib/server/maintenance/index.ts",
    {
      "../../maintenance": libUrl,
      "./service": serviceUrl,
    },
  );

  return {
    lib: await import(libUrl),
    service: await import(indexUrl),
    urls: {
      auditUrl,
      databaseUrl,
      indexUrl,
      libUrl,
      schemaUrl,
      serviceUrl,
      storageUrl,
      transportUrl,
    },
  };
}

export async function loadMaintenanceRoutes(modules) {
  const nextServerUrl = new URL(
    "../../node_modules/next/server.js",
    import.meta.url,
  ).href;
  const authModules = createAuthModuleUrls();
  const httpUrl = loadTypeScriptModule(
    "src/lib/server/maintenance/http.ts",
    {
      "../../maintenance": modules.urls.libUrl,
      "../auth": authModules.authUrl,
      "../auth-config": authModules.configUrl,
      ".": modules.urls.indexUrl,
      "next/server": nextServerUrl,
    },
  );
  const routeImports = {
    "@/lib/server/maintenance/http": httpUrl,
    "next/server": nextServerUrl,
  };
  const listRouteUrl = loadTypeScriptModule(
    "src/app/api/console/announcements/route.ts",
    routeImports,
  );
  const detailRouteUrl = loadTypeScriptModule(
    "src/app/api/console/announcements/[id]/route.ts",
    routeImports,
  );
  const retryRouteUrl = loadTypeScriptModule(
    "src/app/api/console/announcements/[id]/retry/route.ts",
    routeImports,
  );
  const cancelRouteUrl = loadTypeScriptModule(
    "src/app/api/console/announcements/[id]/cancel/route.ts",
    routeImports,
  );

  return {
    cancelRoute: await import(cancelRouteUrl),
    detailRoute: await import(detailRouteUrl),
    listRoute: await import(listRouteUrl),
    loginRoute: await import(authModules.loginUrl),
    retryRoute: await import(retryRouteUrl),
  };
}

export async function createTempDatabase(prefix = "maintenance-test-") {
  const tmpRoot = fileURLToPath(new URL("../../tmp/", import.meta.url));
  await mkdir(tmpRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tmpRoot, prefix));

  return {
    databasePath: path.join(directory, "console.sqlite"),
    directory,
    async cleanup() {
      await rm(directory, { force: true, recursive: true });
    },
  };
}

/**
 * Start a local HTTP upstream. The handler receives the parsed request and
 * returns {status, body, headers} or {destroy:true} to simulate a transport
 * failure. Every call is recorded for path/body/header assertions.
 */
export async function startFakeUpstream(handler) {
  const requests = [];
  let currentHandler = handler;

  const server = createServer(async (request, response) => {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    const text = Buffer.concat(chunks).toString("utf8");
    const recorded = {
      body: text,
      headers: request.headers,
      method: request.method,
      url: request.url,
    };
    requests.push(recorded);

    let result;

    try {
      result = await currentHandler(recorded);
    } catch (error) {
      response.destroy(error);
      return;
    }

    if (result?.destroy) {
      response.destroy();
      return;
    }

    const status = result?.status ?? 200;
    const body = result?.body ?? JSON.stringify({ results: [], total: 0 });
    response.writeHead(status, {
      "content-type": "application/json",
      ...(result?.headers ?? {}),
    });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    setHandler(nextHandler) {
      currentHandler = nextHandler;
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function successfulResponse(groupIds, overrides = new Map()) {
  return {
    results: groupIds.map((groupId) => {
      const override = overrides.get(groupId);

      if (override) {
        return override;
      }

      return {
        bot_id: "bot-1",
        error: null,
        error_code: null,
        group_id: groupId,
        status: "success",
        success: true,
      };
    }),
    success_count: groupIds.length,
    total: groupIds.length,
    failed_count: 0,
    unavailable_bot_count: 0,
    unreachable_count: 0,
  };
}

export function maintenanceInput(patch = {}) {
  return {
    content: "预计维护 10 分钟\n期间可能出现短暂不可用",
    groupIds: [101, 202],
    maintenanceTime: "2026-11-01 22:00 - 23:00",
    mode: "immediate",
    plannedAt: null,
    title: "Komari 服务维护通知",
    ...patch,
  };
}

export function readJsonBody(request) {
  return JSON.parse(request.body);
}

/** Read the database plus WAL sidecars so secret-persistence scans are real. */
export function readDatabaseBytes(databasePath) {
  const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];

  return Buffer.concat(
    paths
      .filter((candidate) => existsSync(candidate))
      .map((candidate) => readFileSync(candidate)),
  );
}
