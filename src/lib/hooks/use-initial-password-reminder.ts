import { useMutation } from "@tanstack/react-query";

const DISMISS_REMINDER_PATH = "/api/auth/initial-password-reminder/dismiss";
// Wire marker mirrored by src/lib/server/auth.ts; do not import server auth here.
const CONSOLE_UNAUTHENTICATED_CODE = "CONSOLE_UNAUTHENTICATED";
const SAVE_FAILED_MESSAGE = "保存提醒状态失败，请稍后重试。";
const NETWORK_FAILED_MESSAGE = "保存提醒状态失败，请检查网络连接后重试。";

/**
 * Persist the account-level initial-password reminder dismissal for the
 * current session. The modal closes only after this resolves, so a failed
 * save keeps the reminder and its retry action visible.
 */
export function useDismissInitialPasswordReminder() {
  return useMutation({
    mutationFn: requestDismissInitialPasswordReminder,
  });
}

async function requestDismissInitialPasswordReminder(): Promise<void> {
  let response: Response;

  try {
    response = await fetch(DISMISS_REMINDER_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
    });
  } catch {
    throw new Error(NETWORK_FAILED_MESSAGE);
  }

  const payload = await readJsonBody(response);

  if (response.status === 401 && isConsoleUnauthenticated(payload)) {
    redirectToLogin();
  }

  if (!response.ok) {
    throw new Error(readMessage(payload) ?? SAVE_FAILED_MESSAGE);
  }

  if (!isDismissedPayload(payload)) {
    throw new Error(SAVE_FAILED_MESSAGE);
  }
}

function isDismissedPayload(payload: unknown) {
  return (
    !!payload &&
    typeof payload === "object" &&
    Reflect.get(payload, "reminderDismissed") === true
  );
}

function isConsoleUnauthenticated(payload: unknown) {
  return (
    !!payload &&
    typeof payload === "object" &&
    Reflect.get(payload, "code") === CONSOLE_UNAUTHENTICATED_CODE
  );
}

function redirectToLogin() {
  if (typeof window === "undefined" || window.location.pathname === "/login") {
    return;
  }

  window.location.replace("/login");
}

async function readJsonBody(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function readMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const message = Reflect.get(payload, "message");
  return typeof message === "string" && message.trim() ? message : null;
}
