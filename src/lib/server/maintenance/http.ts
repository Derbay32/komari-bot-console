import { NextResponse } from "next/server";

import {
  MaintenanceConflictError,
  MaintenanceInputError,
  parseMaintenanceCancelInput,
  parseMaintenanceCreateInput,
  parseMaintenanceUpdateInput,
  validateMaintenanceSubmissionId,
} from "../../maintenance";
import { authorizeConsoleRequest } from "../auth";
import { getConsoleAuthConfig } from "../auth-config";
import {
  createMaintenanceService,
  type MaintenanceService,
} from ".";

const MAX_REQUEST_BODY_BYTES = 65_536;
const MAX_NOTICE_ID_LENGTH = 128;

const CREATE_FAILED_MESSAGE = "保存维护通知失败。";
const UPDATE_FAILED_MESSAGE = "保存维护通知修改失败。";
const CANCEL_FAILED_MESSAGE = "取消维护通知失败。";
const LIST_FAILED_MESSAGE = "读取维护通知列表失败。";
const DETAIL_FAILED_MESSAGE = "读取维护通知详情失败。";
const CONFIG_UNAVAILABLE_MESSAGE = "控制台配置不可用。";
const NOT_FOUND_MESSAGE = "通知不存在。";

type DetailContext = {
  params: Promise<{ id: string }>;
};

export async function listAnnouncements(request: Request) {
  const authorization = await authorizeConsoleRequest(request);

  if (!authorization.authorized) {
    return noStore(authorization.response);
  }

  let maintenance: MaintenanceService;

  try {
    maintenance = createHttpMaintenanceService();
  } catch {
    return errorResponse(CONFIG_UNAVAILABLE_MESSAGE, 500);
  }

  try {
    const notices = await maintenance.list();
    return jsonResponse({ notices }, 200);
  } catch {
    return errorResponse(LIST_FAILED_MESSAGE, 500);
  }
}

export async function createAnnouncement(request: Request) {
  const authorization = await authorizeConsoleRequest(request);

  if (!authorization.authorized) {
    return noStore(authorization.response);
  }

  let submissionId: string;

  try {
    submissionId = validateMaintenanceSubmissionId(
      request.headers.get("x-request-id"),
    );
  } catch (error) {
    return inputErrorResponse(error);
  }

  let input: ReturnType<typeof parseMaintenanceCreateInput>;

  try {
    input = parseMaintenanceCreateInput(await readBoundedJson(request));
  } catch (error) {
    return inputErrorResponse(error);
  }

  let maintenance: MaintenanceService;

  try {
    maintenance = createHttpMaintenanceService();
  } catch {
    return errorResponse(CONFIG_UNAVAILABLE_MESSAGE, 500);
  }

  try {
    const result = await maintenance.create(input, submissionId);
    return jsonResponse({ notice: result.notice }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof MaintenanceConflictError) {
      return errorResponse(error.message, 409);
    }

    if (error instanceof MaintenanceInputError) {
      return errorResponse(error.message, 400);
    }

    return errorResponse(CREATE_FAILED_MESSAGE, 500);
  }
}

export async function getAnnouncement(
  request: Request,
  context: DetailContext,
) {
  const authorization = await authorizeConsoleRequest(request);

  if (!authorization.authorized) {
    return noStore(authorization.response);
  }

  const { id } = await context.params;

  if (!isValidNoticeId(id)) {
    return errorResponse(NOT_FOUND_MESSAGE, 404);
  }

  let maintenance: MaintenanceService;

  try {
    maintenance = createHttpMaintenanceService();
  } catch {
    return errorResponse(CONFIG_UNAVAILABLE_MESSAGE, 500);
  }

  try {
    const notice = await maintenance.get(id);

    if (!notice) {
      return errorResponse(NOT_FOUND_MESSAGE, 404);
    }

    return jsonResponse({ notice }, 200);
  } catch {
    return errorResponse(DETAIL_FAILED_MESSAGE, 500);
  }
}

export async function updateAnnouncement(
  request: Request,
  context: DetailContext,
) {
  const authorization = await authorizeConsoleRequest(request);

  if (!authorization.authorized) {
    return noStore(authorization.response);
  }

  const { id } = await context.params;

  if (!isValidNoticeId(id)) {
    return errorResponse(NOT_FOUND_MESSAGE, 404);
  }

  let input: ReturnType<typeof parseMaintenanceUpdateInput>;

  try {
    input = parseMaintenanceUpdateInput(await readBoundedJson(request));
  } catch (error) {
    return inputErrorResponse(error);
  }

  let maintenance: MaintenanceService;

  try {
    maintenance = createHttpMaintenanceService();
  } catch {
    return errorResponse(CONFIG_UNAVAILABLE_MESSAGE, 500);
  }

  try {
    const notice = await maintenance.update(id, input);

    if (!notice) {
      return errorResponse(NOT_FOUND_MESSAGE, 404);
    }

    return jsonResponse({ notice }, 200);
  } catch (error) {
    if (error instanceof MaintenanceConflictError) {
      return conflictResponse(error);
    }

    if (error instanceof MaintenanceInputError) {
      return errorResponse(error.message, 400);
    }

    return errorResponse(UPDATE_FAILED_MESSAGE, 500);
  }
}

export async function cancelAnnouncement(
  request: Request,
  context: DetailContext,
) {
  const authorization = await authorizeConsoleRequest(request);

  if (!authorization.authorized) {
    return noStore(authorization.response);
  }

  const { id } = await context.params;

  if (!isValidNoticeId(id)) {
    return errorResponse(NOT_FOUND_MESSAGE, 404);
  }

  let input: ReturnType<typeof parseMaintenanceCancelInput>;

  try {
    input = parseMaintenanceCancelInput(await readBoundedJson(request));
  } catch (error) {
    return inputErrorResponse(error);
  }

  let maintenance: MaintenanceService;

  try {
    maintenance = createHttpMaintenanceService();
  } catch {
    return errorResponse(CONFIG_UNAVAILABLE_MESSAGE, 500);
  }

  try {
    const notice = await maintenance.cancel(id, input);

    if (!notice) {
      return errorResponse(NOT_FOUND_MESSAGE, 404);
    }

    return jsonResponse({ notice }, 200);
  } catch (error) {
    if (error instanceof MaintenanceConflictError) {
      return conflictResponse(error);
    }

    if (error instanceof MaintenanceInputError) {
      return errorResponse(error.message, 400);
    }

    return errorResponse(CANCEL_FAILED_MESSAGE, 500);
  }
}

function isValidNoticeId(id: unknown): id is string {
  return typeof id === "string" && Boolean(id) && id.length <= MAX_NOTICE_ID_LENGTH;
}

function conflictResponse(error: MaintenanceConflictError) {
  if (error.currentNotice) {
    return jsonResponse(
      {
        currentNotice: error.currentNotice,
        message: error.message,
      },
      409,
    );
  }

  return errorResponse(error.message, 409);
}

function createHttpMaintenanceService() {
  const config = getConsoleAuthConfig();

  return createMaintenanceService({
    databasePath: config.databasePath,
    upstream: () => {
      throw new Error("HTTP 路由不得执行维护通知发送。");
    },
  });
}

async function readBoundedJson(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BODY_BYTES
  ) {
    throw new MaintenanceInputError("请求体过大。");
  }

  const text = await readBoundedText(request);

  if (text === null) {
    throw new MaintenanceInputError("请求体过大。");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MaintenanceInputError("请求体不是有效的 JSON。");
  }
}

async function readBoundedText(request: Request) {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalLength += value.byteLength;

    if (totalLength > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function inputErrorResponse(error: unknown) {
  if (error instanceof MaintenanceInputError) {
    return errorResponse(error.message, 400);
  }

  return errorResponse("请求输入无效。", 400);
}

function jsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "cache-control": "no-store, private" },
    status,
  });
}

function errorResponse(message: string, status: number) {
  return jsonResponse({ message }, status);
}

function noStore(response: Response) {
  response.headers.set("cache-control", "no-store, private");
  return response;
}
