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
    "X-Komari-Change-Reason": sanitizedReason.slice(0, 200),
    "X-Request-ID": requestId,
  };
}
