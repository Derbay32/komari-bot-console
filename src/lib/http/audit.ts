const REQUEST_ID_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,19}$/;

export function createRequestId(prefix: string): string {
  if (!REQUEST_ID_PREFIX_PATTERN.test(prefix)) {
    throw new Error("请求 ID 前缀必须以字母或数字开头，且长度不超过 20 个合法字符");
  }

  const randomPart =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.replace(
      /[^A-Za-z0-9_.:-]/g,
      "",
    );

  return `${prefix}-${randomPart}`.slice(0, 64);
}

export function buildAuditHeaders(
  reason: string,
  requestId = createRequestId("web"),
): Record<string, string> {
  const sanitizedReason = reason.trim() || "unspecified-change";

  return {
    "X-Komari-Change-Reason": toLatin1HeaderValue(
      sanitizedReason.slice(0, 200),
    ),
    "X-Request-ID": requestId,
  };
}

/**
 * 浏览器 fetch 的请求头只允许 Latin-1 字符，中文会直接抛出 TypeError，
 * 导致请求尚未发出就失败。
 * 这里将字符串按 UTF-8 编码后逐字节映射为 Latin-1 字符，
 * 后端会按 latin-1 → utf-8 还原出原文；纯 ASCII 内容不受影响。
 */
function toLatin1HeaderValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let result = "";

  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }

  return result;
}
