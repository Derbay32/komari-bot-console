"use client";

import { Alert, App, Button, Modal, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type * as React from "react";

import styles from "@/components/announce/announce.module.css";
import { observePromise } from "@/lib/async";
import { createRequestId } from "@/lib/http/audit";
import { ApiError } from "@/lib/http/client";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useGroupList,
  useRetryAnnouncement,
  useRetryAnnouncementPreview,
} from "@/lib/hooks/use-announce";

type ConfirmedRetryPayload = {
  version: number;
  groupIds: number[];
};

/**
 * Read-only confirmation for one manual retry. The preview token is unique to
 * this mounted confirmation session; a conflict requires closing and opening a
 * fresh session instead of mutating the already-confirmed payload.
 */
export function AnnounceRetryModal({
  noticeId,
  onClose,
}: {
  noticeId: string;
  onClose: () => void;
}) {
  const { message: messageApi } = App.useApp();
  const previewToken = useId();
  const previewQuery = useRetryAnnouncementPreview(noticeId, previewToken);
  const groupsQuery = useGroupList();
  const retryMutation = useRetryAnnouncement();
  const groupNameMap = useMemo(
    () =>
      new Map(
        (groupsQuery.data?.groups ?? []).map(
          (group) => [group.group_id, group.group_name] as const,
        ),
      ),
    [groupsQuery.data?.groups],
  );
  const preview = previewQuery.data?.preview ?? null;
  const [open, setOpen] = useState(true);
  const [conflictBlocked, setConflictBlocked] = useState(false);
  const submissionRef = useRef<string | null>(null);
  const confirmedRef = useRef<ConfirmedRetryPayload | null>(null);
  const inFlightRef = useRef(false);
  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    closingRef.current = true;
    setOpen(false);
  }, []);
  const canConfirm =
    open &&
    preview !== null &&
    preview.targetGroupIds.length > 0 &&
    preview.blockedReason === null &&
    !conflictBlocked;

  const handleConfirm = useCallback(async () => {
    if (
      closingRef.current ||
      !preview ||
      !canConfirm ||
      inFlightRef.current
    ) {
      return;
    }

    const confirmed = confirmedRef.current ?? {
      groupIds: [...preview.targetGroupIds],
      version: preview.version,
    };
    const submissionId =
      submissionRef.current ?? createRequestId("web-announce-retry");

    confirmedRef.current = confirmed;
    submissionRef.current = submissionId;
    inFlightRef.current = true;

    try {
      await retryMutation.mutateAsync({
        groupIds: confirmed.groupIds,
        noticeId,
        submissionId,
        version: confirmed.version,
      });
      observePromise(messageApi.success("重试任务已保存，等待 Worker 发送。"));
      requestClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflictBlocked(true);
        observePromise(
          messageApi.error(
            "重试名单已过期或状态已变化。关闭本弹窗后重新打开，获取最新名单。",
          ),
        );
      } else {
        observePromise(
          messageApi.error(
            getRequestErrorMessage(error, "保存重试任务失败。"),
          ),
        );
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [
    canConfirm,
    messageApi,
    noticeId,
    preview,
    requestClose,
    retryMutation,
  ]);

  return (
    <Modal
      open={open}
      centered
      width={720}
      title="手动重试失败群"
      onCancel={requestClose}
      afterClose={onClose}
      wrapProps={{
        onKeyDownCapture: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            // Prevent the browser Escape default while leaving dismissal to AntD.
            event.preventDefault();
          }
        },
      }}
      classNames={{ body: styles.modalBody }}
      footer={[
        <Button key="cancel" onClick={requestClose}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          disabled={!canConfirm}
          loading={retryMutation.isPending}
          onClick={() => {
            handleConfirm().catch((error: unknown) => {
              console.error("重试操作失败", error);
            });
          }}
        >
          确认重试
        </Button>,
      ]}
    >
      {previewQuery.isPending ? (
        <Space className={styles.loadingBlock}>
          <Spin />
          <Typography.Text type="secondary">加载可重试名单...</Typography.Text>
        </Space>
      ) : null}

      {previewQuery.isError ? (
        <Alert
          showIcon
          type="error"
          title="可重试名单加载失败"
          description={getRequestErrorMessage(
            previewQuery.error,
            "请稍后重试。",
          )}
        />
      ) : null}

      {preview ? (
        <Space orientation="vertical" size={16} style={{ display: "flex" }}>
          <Alert
            showIcon
            type="info"
            title="只重试当前可重试的目标群"
            description="沿用原通知的标题、正文和维护时间。确认后保存为原通知下的新发送尝试。内容和目标范围保持只读。"
          />

          <section className={styles.detailSection}>
            <Space size={8} wrap>
              <Typography.Text strong>{preview.title}</Typography.Text>
              <Tag>版本 {preview.version}</Tag>
            </Space>
            <Typography.Text type="secondary">
              维护时间：{preview.maintenanceTime}
            </Typography.Text>
            <div className={styles.fullText}>{preview.content}</div>
          </section>

          <section className={styles.detailSection}>
            <Space size={8} wrap>
              <Typography.Text strong>本次重试目标群</Typography.Text>
              <Tag color={preview.targetGroupIds.length > 0 ? "blue" : "default"}>
                {preview.targetGroupIds.length} 个
              </Tag>
              <Typography.Text type="secondary">
                按原通知目标顺序
              </Typography.Text>
            </Space>

            {preview.targetGroupIds.length > 0 ? (
              <div className={styles.targetGrid}>
                {preview.targetGroupIds.map((groupId) => (
                  <div key={groupId} className={styles.targetRow}>
                    <div className={styles.targetName}>
                      <span>{groupNameMap.get(groupId) ?? "未知群聊"}</span>
                      <span className={styles.targetId}>{groupId}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {preview.blockedReason ? (
            <Alert
              showIcon
              type="warning"
              title="暂不能重试"
              description={preview.blockedReason}
            />
          ) : null}

          {conflictBlocked ? (
            <Alert
              showIcon
              type="error"
              title="名单已过期"
              description="服务端已拒绝本次确认。关闭本弹窗后重新打开，获取最新名单。系统不会自动更换提交标识，也不会改用旧名单。"
            />
          ) : null}

          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            确认只保存新的发送尝试。独立 Worker 执行实际发送，并写入逐群结果。成功提示不代表已送达。
          </Typography.Paragraph>
        </Space>
      ) : null}
    </Modal>
  );
}
