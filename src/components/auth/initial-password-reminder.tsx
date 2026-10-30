"use client";

import { Alert, Button, Modal, Typography } from "antd";
import { useState } from "react";

import { observeCallback } from "@/lib/async";
import { useDismissInitialPasswordReminder } from "@/lib/hooks/use-initial-password-reminder";

const REMINDER_MESSAGE =
  "你正在使用随机初始密码，请到「设置」-「账户安全」-「管理账户」修改密码";
const SAVE_FAILED_MESSAGE = "保存提醒状态失败，请稍后重试。";

type InitialPasswordReminderProps = {
  isRandomInitialPassword: boolean;
  reminderDismissed: boolean;
};

/**
 * Session-visit reminder for the random initial administrator password. The
 * reminder is dismissed for this mount only by confirm, mask, close, or Esc;
 * the persistent dismissal is written by 关闭提醒 after the request succeeds.
 */
export function InitialPasswordReminder({
  isRandomInitialPassword,
  reminderDismissed,
}: InitialPasswordReminderProps) {
  const dismissReminder = useDismissInitialPasswordReminder();
  const [visitDismissed, setVisitDismissed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const saving = dismissReminder.isPending;
  const open =
    isRandomInitialPassword && !reminderDismissed && !visitDismissed;

  function handleConfirm() {
    if (saving) {
      return;
    }

    setVisitDismissed(true);
  }

  async function handleDismiss() {
    setErrorMessage(null);

    try {
      await dismissReminder.mutateAsync();
      setVisitDismissed(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : SAVE_FAILED_MESSAGE,
      );
    }
  }

  return (
    <Modal
      open={open}
      title="初始密码提醒"
      closable={!saving}
      keyboard={!saving}
      mask={{ closable: !saving }}
      onCancel={handleConfirm}
      footer={
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <Button disabled={saving} onClick={handleConfirm}>
            确认
          </Button>
          <Button
            type="primary"
            disabled={saving}
            loading={saving}
            onClick={observeCallback(handleDismiss)}
          >
            关闭提醒
          </Button>
        </div>
      }
    >
      {errorMessage ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        {REMINDER_MESSAGE}
      </Typography.Paragraph>
    </Modal>
  );
}
