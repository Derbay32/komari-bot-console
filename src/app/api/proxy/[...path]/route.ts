import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { authorizeConsoleRequest } from "@/lib/server/auth";
import { getRuntimeConfig } from "@/lib/server/runtime-config";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

async function proxyRequest(request: NextRequest, context: RouteContext) {
  const authorization = await authorizeConsoleRequest(request);

  if (!authorization.authorized) {
    authorization.response.headers.set("cache-control", "no-store, private");
    return authorization.response;
  }

  try {
    const { path } = await context.params;
    const { apiOrigin, bearerToken } = await getRuntimeConfig();
    const upstreamUrl = new URL(apiOrigin);

    upstreamUrl.pathname = `/${path.join("/")}`;
    upstreamUrl.search = request.nextUrl.search;
    upstreamUrl.hash = "";

    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${bearerToken}`);
    headers.delete("connection");
    headers.delete("content-length");
    headers.delete("cookie");
    headers.delete("host");

    const body = canHaveBody(request.method) ? await request.arrayBuffer() : undefined;
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("set-cookie");
    responseHeaders.delete("transfer-encoding");
    responseHeaders.set("cache-control", "no-store, private");

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      {
        message: "上游服务请求失败。",
      },
      {
        headers: { "cache-control": "no-store, private" },
        status: 502,
      },
    );
  }
}

function canHaveBody(method: string) {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
