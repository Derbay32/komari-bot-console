import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as flushMacrotask } from "node:timers/promises";

import {
  capturedMutations,
  capturedQueries,
  configureQueryClient,
  resetCapturedHooks,
} from "./react-query-stub.mjs";
import { loadTypeScriptModule, toDataUrl } from "./typescript-modules.mjs";

const queryStubUrl = new URL("./react-query-stub.mjs", import.meta.url).href;
const asyncUrl = loadTypeScriptModule("src/lib/async.ts");
const clientUrl = loadTypeScriptModule("src/lib/http/client.ts");
const auditUrl = loadTypeScriptModule("src/lib/http/audit.ts");
const knowledgeUrl = loadTypeScriptModule("src/lib/knowledge.ts");

const knowledgeHooks = await import(
  loadTypeScriptModule("src/lib/hooks/use-knowledge.ts", {
    "@tanstack/react-query": queryStubUrl,
    "@/lib/async": asyncUrl,
    "@/lib/http/audit": auditUrl,
    "@/lib/http/client": clientUrl,
    "@/lib/knowledge": knowledgeUrl,
  })
);
const helpHooks = await import(
  loadTypeScriptModule("src/lib/hooks/use-help.ts", {
    "@tanstack/react-query": queryStubUrl,
    "@/lib/async": asyncUrl,
    "@/lib/http/audit": auditUrl,
    "@/lib/http/client": clientUrl,
  })
);
const banHooks = await import(
  loadTypeScriptModule("src/lib/hooks/use-bans.ts", {
    "@tanstack/react-query": queryStubUrl,
    "@/lib/async": asyncUrl,
    "@/lib/http/audit": auditUrl,
    "@/lib/http/client": clientUrl,
  })
);
const knowledge = await import(knowledgeUrl);

const dashboardUrl = loadTypeScriptModule("src/components/dashboard-overview.tsx", {
  "@ant-design/icons": toDataUrl(
    "export function BookOutlined() { return null; }",
  ),
  "@/components/brand-logo": toDataUrl(
    "export function D20Icon() { return null; }",
  ),
  "@/lib/http/client": clientUrl,
  "@tanstack/react-query": queryStubUrl,
  antd: toDataUrl(`
    export function Alert() { return null; }
    export function Card() { return null; }
    export function Col() { return null; }
    export function Row() { return null; }
    export function Space() { return null; }
    export function Statistic() { return null; }
    export const Typography = {
      Title() { return null; },
      Text() { return null; },
    };
  `),
  "next/link": toDataUrl(
    "export default function Link() { return null; }",
  ),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
});
const { DashboardOverview } = await import(dashboardUrl);

const originalFetch = globalThis.fetch;
const invalidations = [];
const queryClient = {
  invalidateQueries({ queryKey }) {
    invalidations.push(queryKey);
    return Promise.resolve();
  },
};
let fetchHandler = () => jsonResponse({});
let requests = [];

beforeEach(() => {
  requests = [];
  invalidations.length = 0;
  resetCapturedHooks();
  configureQueryClient(queryClient);
  fetchHandler = () => jsonResponse({});
  globalThis.fetch = async (input, init = {}) => {
    const request = {
      body: init.body,
      cache: init.cache,
      headers: new Headers(init.headers),
      method: init.method,
      url: String(input),
    };
    requests.push(request);
    return fetchHandler(request);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function emptyResponse() {
  return new Response(null, { status: 204 });
}

function proxyUrl(request, path) {
  const url = new URL(request.url, "http://console.test");
  assert.equal(url.pathname, `/api/proxy${path}`);
  return url;
}

function assertGet(request, path, queryEntries = []) {
  assert.equal(request.method, undefined);
  assert.equal(request.body, undefined);
  assert.equal(request.cache, "no-store");
  const url = proxyUrl(request, path);
  assert.deepEqual(
    [...url.searchParams.entries()].sort(),
    [...queryEntries].sort(),
  );
}

function assertJsonRequest(request, method, path, body) {
  assert.equal(request.method, method);
  assert.equal(request.cache, "no-store");
  assert.equal(request.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(request.body), body);
  proxyUrl(request, path);
}

function decodeAuditReason(request) {
  const header = request.headers.get("x-komari-change-reason");
  assert.equal(typeof header, "string");
  return new TextDecoder().decode(
    Uint8Array.from(header, (character) => character.charCodeAt(0)),
  );
}

async function executeQuery(hook, argument) {
  resetCapturedHooks();
  hook(argument);
  assert.equal(capturedQueries.length, 1);
  assert.equal(capturedMutations.length, 0);
  const config = capturedQueries[0];
  const data = await config.queryFn();
  assert.equal(requests.length, 1);
  return { config, data, request: requests[0] };
}

async function executeMutation(hook, variables) {
  resetCapturedHooks();
  hook();
  assert.equal(capturedMutations.length, 1);
  assert.equal(capturedQueries.length, 0);
  const config = capturedMutations[0];
  const data = await config.mutationFn(variables);
  config.onSuccess?.(data, variables, undefined);
  await flushMacrotask();
  assert.equal(requests.length, 1);
  return { config, data, request: requests[0] };
}

const knowledgeEntry = {
  category: "custom",
  content: "自定义知识",
  created_at: "2026-10-27T10:00:00Z",
  id: 7,
  keywords: ["自定义"],
  notes: null,
  updated_at: "2026-10-27T10:00:00Z",
};

const helpEntry = {
  category: "command",
  content: "帮助内容",
  created_at: "2026-10-27T10:00:00Z",
  id: 9,
  is_auto_generated: false,
  keywords: ["帮助"],
  notes: null,
  plugin_name: "demo",
  title: "帮助标题",
  updated_at: "2026-10-27T10:00:00Z",
};

describe("knowledge v2 endpoints", () => {
  it("lists through the v2 proxy with pagination and custom category filters", async () => {
    const payload = { items: [knowledgeEntry], limit: 20, offset: 40, total: 1 };
    fetchHandler = () => jsonResponse(payload);
    const params = { category: "custom", limit: 20, offset: 40, q: "魔法" };

    const { config, data, request } = await executeQuery(
      knowledgeHooks.useKnowledgeList,
      params,
    );

    assert.deepEqual(config.queryKey, ["knowledge", "list", params]);
    assertGet(request, "/api/v2/komari-knowledge/knowledge", [
      ["q", "魔法"],
      ["category", "custom"],
      ["limit", "20"],
      ["offset", "40"],
    ]);
    assert.deepEqual(data, payload);
  });

  it("gets one v2 knowledge entry", async () => {
    fetchHandler = () => jsonResponse(knowledgeEntry);

    const { config, data, request } = await executeQuery(
      knowledgeHooks.useKnowledge,
      7,
    );

    assert.deepEqual(config.queryKey, ["knowledge", "detail", 7]);
    assert.equal(config.enabled, true);
    assertGet(request, "/api/v2/komari-knowledge/knowledge/7");
    assert.deepEqual(data, knowledgeEntry);
  });

  it("creates an ordinary or custom knowledge entry with POST", async () => {
    fetchHandler = () => jsonResponse(knowledgeEntry, 201);
    const body = {
      category: "custom",
      content: "自定义知识",
      keywords: ["自定义", "设定"],
      notes: "备注",
    };

    const { data, request } = await executeMutation(
      knowledgeHooks.useCreateKnowledge,
      body,
    );

    assertJsonRequest(
      request,
      "POST",
      "/api/v2/komari-knowledge/knowledge",
      body,
    );
    assert.deepEqual(data, knowledgeEntry);
    assert.deepEqual(invalidations, [["knowledge", "list"]]);
  });

  it("updates a v2 knowledge entry with PATCH", async () => {
    fetchHandler = () => jsonResponse(knowledgeEntry);
    const body = {
      category: "custom",
      content: "更新后的自定义知识",
      keywords: ["自定义"],
    };
    const variables = { data: body, kid: 7 };

    const { request } = await executeMutation(
      knowledgeHooks.useUpdateKnowledge,
      variables,
    );

    assertJsonRequest(
      request,
      "PATCH",
      "/api/v2/komari-knowledge/knowledge/7",
      body,
    );
    assert.deepEqual(invalidations, [["knowledge", "list"]]);
  });

  it("treats a 204 knowledge deletion as a successful null response", async () => {
    fetchHandler = emptyResponse;

    const { data, request } = await executeMutation(
      knowledgeHooks.useDeleteKnowledge,
      7,
    );

    assert.equal(data, null);
    assert.equal(request.method, "DELETE");
    assert.equal(request.body, undefined);
    proxyUrl(request, "/api/v2/komari-knowledge/knowledge/7");
    assert.deepEqual(invalidations, [["knowledge", "list"]]);
  });

  it("searches knowledge with POST", async () => {
    fetchHandler = () =>
      jsonResponse([
        {
          category: "custom",
          content: "命中内容",
          id: 7,
          similarity: 0.8,
          source: "keyword",
        },
      ]);
    const body = { limit: 5, query: "自定义" };

    const { request } = await executeMutation(
      knowledgeHooks.useSearchKnowledge,
      body,
    );

    assertJsonRequest(
      request,
      "POST",
      "/api/v2/komari-knowledge/search",
      body,
    );
    assert.deepEqual(invalidations, []);
  });
});

describe("help v2 endpoints", () => {
  it("lists through the v2 proxy with filters and pagination", async () => {
    fetchHandler = () =>
      jsonResponse({ items: [helpEntry], limit: 20, offset: 20, total: 21 });
    const params = { category: "faq", limit: 20, offset: 20, q: "帮助" };

    const { config, request } = await executeQuery(
      helpHooks.useHelpList,
      params,
    );

    assert.deepEqual(config.queryKey, ["help", "list", params]);
    assertGet(request, "/api/v2/komari-help/help", [
      ["q", "帮助"],
      ["category", "faq"],
      ["limit", "20"],
      ["offset", "20"],
    ]);
  });

  it("gets one v2 help entry", async () => {
    fetchHandler = () => jsonResponse(helpEntry);

    const { config, request } = await executeQuery(helpHooks.useHelp, 9);

    assert.deepEqual(config.queryKey, ["help", "detail", 9]);
    assert.equal(config.enabled, true);
    assertGet(request, "/api/v2/komari-help/help/9");
  });

  it("creates a v2 help entry with POST", async () => {
    fetchHandler = () => jsonResponse(helpEntry, 201);
    const body = {
      category: "command",
      content: "帮助内容",
      keywords: ["帮助"],
      notes: null,
      plugin_name: "demo",
      title: "帮助标题",
    };

    const { request } = await executeMutation(helpHooks.useCreateHelp, body);

    assertJsonRequest(request, "POST", "/api/v2/komari-help/help", body);
    assert.deepEqual(invalidations, [["help", "list"]]);
  });

  it("updates a v2 help entry with PATCH", async () => {
    fetchHandler = () => jsonResponse(helpEntry);
    const body = { category: "faq", title: "更新后的标题" };

    const { request } = await executeMutation(helpHooks.useUpdateHelp, {
      data: body,
      hid: 9,
    });

    assertJsonRequest(request, "PATCH", "/api/v2/komari-help/help/9", body);
    assert.deepEqual(invalidations, [["help", "list"], ["help", "detail"]]);
  });

  it("treats a 204 help deletion as a successful null response", async () => {
    fetchHandler = emptyResponse;

    const { data, request } = await executeMutation(helpHooks.useDeleteHelp, 9);

    assert.equal(data, null);
    assert.equal(request.method, "DELETE");
    assert.equal(request.body, undefined);
    proxyUrl(request, "/api/v2/komari-help/help/9");
    assert.deepEqual(invalidations, [["help", "list"], ["help", "detail"]]);
  });

  it("searches help with POST", async () => {
    fetchHandler = () => jsonResponse([]);
    const body = { limit: 5, query: "帮助" };

    const { request } = await executeMutation(helpHooks.useSearchHelp, body);

    assertJsonRequest(request, "POST", "/api/v2/komari-help/search", body);
  });

  it("scans help with POST and no body", async () => {
    fetchHandler = () => jsonResponse({ updated_count: 3 });

    const { data, request } = await executeMutation(helpHooks.useScanHelp);

    assert.equal(request.method, "POST");
    assert.equal(request.body, undefined);
    proxyUrl(request, "/api/v2/komari-help/scan");
    assert.deepEqual(data, { updated_count: 3 });
    assert.deepEqual(invalidations, [["help", "list"]]);
  });
});

describe("user ban v2 endpoints", () => {
  it("lists through the v2 proxy with scope and paging", async () => {
    fetchHandler = () =>
      jsonResponse({ items: [], page: 2, page_size: 50, total: 0 });
    const params = { page: 2, page_size: 50, scope: "chat" };

    const { config, request } = await executeQuery(banHooks.useBanList, params);

    assert.deepEqual(config.queryKey, ["bans", "list", params]);
    assertGet(request, "/api/v2/komari-user-bans/bans", [
      ["scope", "chat"],
      ["page", "2"],
      ["page_size", "50"],
    ]);
  });

  it("creates or updates a ban with POST and encoded Chinese audit headers", async () => {
    fetchHandler = () => jsonResponse({ action: "created" });
    const body = {
      duration: "1d",
      reason: "刷屏",
      scope: "chat",
      user_id: "10001",
    };
    const auditReason = "封禁用户：刷屏";

    const { request } = await executeMutation(
      banHooks.useCreateOrUpdateBan,
      { auditReason, data: body },
    );

    assertJsonRequest(request, "POST", "/api/v2/komari-user-bans/bans", body);
    assert.equal(decodeAuditReason(request), auditReason);
    assert.match(
      request.headers.get("x-request-id"),
      /^web-[A-Za-z0-9_.:-]{1,60}$/,
    );
    assert.deepEqual(invalidations, [["bans", "list"]]);
  });

  it("deletes a ban with encoded path segments and audit headers", async () => {
    fetchHandler = () => jsonResponse({ action: "removed" });
    const auditReason = "解除封禁：误封";
    const variables = {
      auditReason,
      scope: "chat",
      userId: "user/001",
    };

    const { request } = await executeMutation(
      banHooks.useDeleteBan,
      variables,
    );

    assert.equal(request.method, "DELETE");
    assert.equal(request.body, undefined);
    proxyUrl(request, "/api/v2/komari-user-bans/bans/user%2F001/chat");
    assert.equal(decodeAuditReason(request), auditReason);
    assert.match(
      request.headers.get("x-request-id"),
      /^web-[A-Za-z0-9_.:-]{1,60}$/,
    );
    assert.deepEqual(invalidations, [["bans", "list"]]);
  });
});

describe("overview v2 count query", () => {
  it("executes the real dashboard callback with limit 1 and offset 0", async () => {
    fetchHandler = () =>
      jsonResponse({ items: [], limit: 1, offset: 0, total: 7 });
    resetCapturedHooks();

    DashboardOverview();

    assert.equal(capturedQueries.length, 1);
    const config = capturedQueries[0];
    assert.deepEqual(config.queryKey, ["dashboard", "overview"]);
    const data = await config.queryFn();

    assertGet(requests[0], "/api/v2/komari-knowledge/knowledge", [
      ["limit", "1"],
      ["offset", "0"],
    ]);
    assert.deepEqual(data, { knowledgeTotal: 7 });
  });
});

describe("v2 request error propagation", () => {
  it("propagates query failures through the actual apiFetch", async () => {
    const payload = { detail: [{ msg: "分类无效" }] };
    fetchHandler = () => jsonResponse(payload, 422);
    resetCapturedHooks();
    knowledgeHooks.useKnowledgeList({ category: "custom" });
    const config = capturedQueries[0];

    await assert.rejects(config.queryFn(), (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 422);
      assert.equal(error.message, "分类无效");
      assert.deepEqual(error.payload, payload);
      return true;
    });
  });

  it("propagates mutation failures without invalidating lists", async () => {
    fetchHandler = () => jsonResponse({ detail: "数据库不可用" }, 500);
    resetCapturedHooks();
    knowledgeHooks.useCreateKnowledge();
    const config = capturedMutations[0];

    await assert.rejects(
      config.mutationFn({
        category: "custom",
        content: "内容",
        keywords: ["关键词"],
      }),
      (error) => {
        assert.equal(error.name, "ApiError");
        assert.equal(error.status, 500);
        assert.equal(error.message, "数据库不可用");
        return true;
      },
    );
    assert.deepEqual(invalidations, []);
  });
});

describe("knowledge category and keyword behavior", () => {
  it("supports the custom category with a Chinese label and cyan tag", () => {
    assert.equal(knowledge.knowledgeCustomCategoryLabel, "自定义");
    assert.deepEqual(
      knowledge.knowledgeCategoryOptions.map(({ label, value }) => ({
        label,
        value,
      })),
      [
        { label: "通用", value: "general" },
        { label: "角色", value: "character" },
        { label: "设定", value: "setting" },
        { label: "剧情", value: "plot" },
        { label: "其他", value: "other" },
        { label: "自定义", value: "custom" },
      ],
    );
    assert.equal(knowledge.knowledgeCategoryColorMap.custom, "cyan");
    assert.equal(knowledge.knowledgeCategoryColorMap.general, "volcano");
  });

  it("accepts nonempty keywords, including arrays with blank entries", async () => {
    for (const keywords of [
      ["魔法"],
      ["  魔法  "],
      ["", "魔法"],
      [" ", "\t", "设定"],
    ]) {
      assert.equal(knowledge.hasNonEmptyKnowledgeKeywords(keywords), true);
      await assert.doesNotReject(knowledge.validateKnowledgeKeywords(keywords));
    }
  });

  it("rejects missing, empty and whitespace-only keyword arrays", async () => {
    for (const keywords of [
      undefined,
      null,
      [],
      [""],
      ["   "],
      ["\t", "\n"],
      [1, null],
    ]) {
      assert.equal(knowledge.hasNonEmptyKnowledgeKeywords(keywords), false);
      await assert.rejects(knowledge.validateKnowledgeKeywords(keywords), {
        message: "请至少填写一个关键词",
      });
    }
  });

  it("exposes the tested rule through the production keyword form item", async () => {
    const requiredRule = knowledge.knowledgeKeywordsRules.find(
      (rule) => rule.required === true,
    );
    const validatorRule = knowledge.knowledgeKeywordsRules.find(
      (rule) => typeof rule.validator === "function",
    );
    assert.equal(requiredRule?.message, "请至少填写一个关键词");
    assert.ok(validatorRule);
    await assert.doesNotReject(
      validatorRule.validator({}, ["魔法"], () => {}),
    );
    await assert.rejects(validatorRule.validator({}, ["  "], () => {}), {
      message: "请至少填写一个关键词",
    });

    const source = readFileSync(
      new URL(
        "../../src/components/knowledge/knowledge-page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      source,
      /import\s*\{[\s\S]*?knowledgeKeywordsRules[\s\S]*?\}\s*from\s*"@\/lib\/knowledge"/,
    );
    assert.match(
      source,
      /<Form\.Item name="keywords" label="关键词" rules=\{knowledgeKeywordsRules\}>/,
    );
    assert.match(
      source,
      /const values = await form\.validateFields\(\)\.catch\(\(\) => null\);/,
    );
    assert.doesNotMatch(source, /const categoryOptions:/);
    assert.doesNotMatch(source, /const categoryColorMap:/);
    assert.equal(
      (source.match(/options=\{knowledgeCategoryOptions\}/g) ?? []).length,
      2,
    );
    assert.match(source, /knowledgeCategoryColorMap\[cat\]/);
    assert.match(source, /item\.category === "custom"/);
    assert.match(source, /knowledgeCustomCategoryLabel/);
  });
});
