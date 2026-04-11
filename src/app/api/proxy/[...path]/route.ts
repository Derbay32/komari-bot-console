import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/runtime-config";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

async function proxyRequest(request: NextRequest, context: RouteContext) {
  try {
    const { path } = await context.params;
    const { apiOrigin, bearerToken } = await getRuntimeConfig();
    const upstreamUrl = new URL(`/${path.join("/")}`, apiOrigin);

    upstreamUrl.search = request.nextUrl.search;

    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${bearerToken}`);
    headers.delete("connection");
    headers.delete("content-length");
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
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "代理请求失败";

    return NextResponse.json(
      {
        message,
      },
      {
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
