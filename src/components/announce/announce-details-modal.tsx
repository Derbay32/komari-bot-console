"use client";

import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Empty,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useCallback, useMemo, useState } from "react";
import type * as React from "react";

import styles from "@/components/announce/announce.module.css";
import { AnnounceRetryModal } from "@/components/announce/announce-retry-modal";
import { observePromise } from "@/lib/async";
import { ApiError } from "@/lib/http/client";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useAnnouncementDetail,
  useCancelAnnouncement,
  useGroupList,
} from "@/lib/hooks/use-announce";
import {
  describeMaintenanceAggregate,
  formatMaintenanceTimestamp,
  getMaintenanceNoticeStatusLabel,
  getMaintenanceOutcomeLabel,
  readMaintenanceConflictPayload,
  type MaintenanceAttempt,
  type MaintenanceAttemptPhase,
  type MaintenanceNotice,
  type MaintenanceNoticeSummary,
  type MaintenanceOutcome,
} from "@/lib/maintenance";

type CancelConflict = {
  message: string;
  currentNotice: MaintenanceNoticeSummary | null;
};

export function AnnounceDetailsModal({
  noticeId,
  onClose,
  onEdit,
}: {
  noticeId: string | null;
  onClose: () => void;
  onEdit: (notice: MaintenanceNotice) => void;
}) {
  const { message: messageApi } = App.useApp();
  const detailQuery = useAnnouncementDetail(noticeId);
  const groupsQuery = useGroupList();
  const [retryOpen, setRetryOpen] = useState(false);
  const cancelMutation = useCancelAnnouncement();
  const [cancelConflict, setCancelConflict] = useState<CancelConflict | null>(
    null,
  );
  const groupNameMap = useMemo(
    () =>
      new Map(
        (groupsQuery.data?.groups ?? []).map(
          (group) => [group.group_id, group.group_name] as const,
        ),
      ),
    [groupsQuery.data?.groups],
  );
  const missing =
    detailQuery.isError &&
    detailQuery.error instanceof ApiError &&
    detailQuery.error.status === 404;
  const notice = missing ? null : (detailQuery.data?.notice ?? null);
  const handleClose = useCallback(() => {
    setCancelConflict(null);
    setRetryOpen(false);
    onClose();
  }, [onClose]);

  const handleCancel = useCallback(async () => {
    if (!notice || cancelMutation.isPending) {
      return;
    }

    try {
      await cancelMutation.mutateAsync({
        id: notice.id,
        version: notice.version,
      });
      setCancelConflict(null);
      observePromise(messageApi.success("通知已取消。"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const conflict = readMaintenanceConflictPayload(error.payload);

        setCancelConflict(
          conflict ?? {
            currentNotice: null,
            message: getRequestErrorMessage(
              error,
              "取消维护通知失败。",
            ),
          },
        );
        observePromise(
          messageApi.error(
            conflict?.message ?? "通知状态已变化，请刷新后重试。",
          ),
        );
        return;
      }

      observePromise(
        messageApi.error(
          getRequestErrorMessage(error, "取消维护通知失败。"),
        ),
      );
    }
  }, [cancelMutation, messageApi, notice]);
  return (
    <>
      <Modal
        open={noticeId !== null}
        centered
        width={860}
        title="通知详情"
        onCancel={handleClose}
        wrapProps={{
          onKeyDownCapture: (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (
              noticeId !== null &&
              event.key === "Escape" &&
              !event.nativeEvent.isComposing
            ) {
              // Prevent the browser Escape default while leaving dismissal to AntD.
              event.preventDefault();
            }
          },
        }}
        classNames={{ body: styles.modalBody }}
        footer={[
          notice?.status === "upcoming" ? (
            <Popconfirm
              key="cancel"
              title="取消这条维护通知？"
              description="取消后不会发送，且无法恢复。"
              okText="确认取消"
              cancelText="返回"
              onConfirm={handleCancel}
            >
              <Button danger loading={cancelMutation.isPending}>
                取消通知
              </Button>
            </Popconfirm>
          ) : null,
          notice?.status === "upcoming" ? (
            <Button
              key="edit"
              type="primary"
              onClick={() => {
                setCancelConflict(null);
                onEdit(notice);
              }}
            >
              编辑
            </Button>
          ) : null,
          notice?.status === "sent" ? (
            <Button
              key="retry"
              icon={<ReloadOutlined />}
              onClick={() => setRetryOpen(true)}
            >
              重试失败群
            </Button>
          ) : null,
          <Button key="close" onClick={handleClose}>
            关闭
          </Button>,
        ]}
      >
        {detailQuery.isPending ? (
          <Space className={styles.loadingBlock}>
            <Spin />
            <Typography.Text type="secondary">加载通知详情...</Typography.Text>
          </Space>
        ) : null}

        {detailQuery.isError && !missing ? (
          <Alert
            showIcon
            type="error"
            title="通知详情加载失败"
            description={getRequestErrorMessage(
              detailQuery.error,
              "请稍后重试。",
            )}
          />
        ) : null}

        {missing ? (
          <Alert
            showIcon
            type="warning"
            title="通知不存在或已被清理"
            description="该通知可能从未存在，或已超过保留期限被清理，无法继续查看详情。"
          />
        ) : null}

        {cancelConflict && !missing ? (
          <Alert
            showIcon
            type="warning"
            title="通知状态已变化"
            description={describeCancelConflict(cancelConflict)}
          />
        ) : null}

        {!detailQuery.isPending && !detailQuery.isError && !notice ? (
          <Empty description="通知不存在" />
        ) : null}

        {notice ? (
          <NoticeDetails notice={notice} groupNameMap={groupNameMap} />
        ) : null}
      </Modal>

      {retryOpen && notice ? (
        <AnnounceRetryModal
          noticeId={notice.id}
          onClose={() => setRetryOpen(false)}
        />
      ) : null}
    </>
  );
}

function NoticeDetails({
  notice,
  groupNameMap,
}: {
  notice: MaintenanceNotice;
  groupNameMap: Map<number, string>;
}) {
  const unexecuted =
    notice.status === "missed" || notice.status === "canceled";

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <div className={styles.detailHeader}>
        <div>
          <Typography.Title level={4} className={styles.detailTitle}>
            {notice.title}
          </Typography.Title>
          <Space size={8} wrap>
            <Tag>
              {getMaintenanceNoticeStatusLabel(
                notice.status,
                notice.activity,
              )}
            </Tag>
            {notice.activity ? <Tag color="processing">执行中</Tag> : null}
            <Tag>{notice.mode === "immediate" ? "立即发送" : "定时发送"}</Tag>
            {notice.status === "missed" ? (
              <Tag color="warning">未执行</Tag>
            ) : null}
            {notice.status === "canceled" ? <Tag>未执行</Tag> : null}
            {notice.aggregate.requiresReconciliation ? (
              <Tag color="warning">需人工核对</Tag>
            ) : null}
          </Space>
        </div>
        <Typography.Text type="secondary">
          版本 {notice.version}
        </Typography.Text>
      </div>

      {notice.status === "missed" ? (
        <Alert
          showIcon
          type="warning"
          title="已错过计划发送时间"
          description="该任务未执行发送，不会自动补发。"
        />
      ) : null}

      {notice.status === "canceled" ? (
        <Alert
          showIcon
          type="warning"
          title="该通知已取消"
          description="未执行发送，没有逐群发送结果，不会自动补发。"
        />
      ) : null}

      {notice.aggregate.requiresReconciliation ? (
        <Alert
          showIcon
          type="warning"
          title="存在需人工核对的目标群"
          description="冲突或未知结果不会自动重试。请先核对平台实际发送情况，再决定后续处理。"
        />
      ) : null}

      <Descriptions
        bordered
        column={{ lg: 2, md: 2, sm: 1, xs: 1 }}
        size="small"
        items={[
          {
            children: notice.maintenanceTime,
            key: "maintenanceTime",
            label: "维护时间",
          },
          {
            children: notice.mode === "immediate" ? "立即发送" : "定时发送",
            key: "mode",
            label: "发送方式",
          },
          ...(notice.mode === "scheduled" && notice.plannedAt !== null
            ? [
                {
                  children: `${formatMaintenanceTimestamp(notice.plannedAt)}（UTC+8）`,
                  key: "plannedAt",
                  label:
                    notice.status === "missed" ||
                    notice.status === "canceled"
                      ? "原计划发送"
                      : "计划发送",
                },
              ]
            : []),
          {
            children: formatMaintenanceTimestamp(notice.createdAt),
            key: "createdAt",
            label: "创建时间",
          },
          {
            children: formatMaintenanceTimestamp(notice.updatedAt),
            key: "updatedAt",
            label: "更新时间",
          },
          {
            children: formatMaintenanceTimestamp(notice.startedAt),
            key: "startedAt",
            label: "开始执行",
          },
          {
            children: formatMaintenanceTimestamp(notice.endedAt),
            key: "endedAt",
            label: notice.status === "canceled" ? "取消时间" : "最近结束",
          },
          {
            children: formatMaintenanceTimestamp(
              notice.lastExecutedAttemptEndedAt,
            ),
            key: "lastExecuted",
            label: "最近有效执行",
          },
          {
            children: `${notice.attemptCount} 次`,
            key: "attempts",
            label: "尝试次数",
          },
        ]}
      />

      <section className={styles.detailSection}>
        <Typography.Text strong>正文</Typography.Text>
        <div className={styles.fullText}>{notice.content}</div>
      </section>

      <section className={styles.detailSection}>
        <Space size={8} wrap>
          <Typography.Text strong>原始目标群</Typography.Text>
          <Tag>{notice.groupIds.length} 个</Tag>
          <Typography.Text type="secondary">
            {unexecuted
              ? "未执行，无逐群发送结果"
              : describeMaintenanceAggregate(notice.aggregate)}
          </Typography.Text>
        </Space>
        <div className={styles.targetGrid}>
          {notice.aggregate.perGroup.map((target) => (
            <div key={target.groupId} className={styles.targetRow}>
              <div className={styles.targetName}>
                <span>{groupNameMap.get(target.groupId) ?? "未知群聊"}</span>
                <span className={styles.targetId}>{target.groupId}</span>
              </div>
              <Space size={4} wrap>
                <Tag
                  color={
                    unexecuted
                      ? "default"
                      : outcomeColor(target.outcome)
                  }
                >
                  {unexecuted
                    ? "未执行"
                    : getMaintenanceOutcomeLabel(target.outcome)}
                </Tag>
                {target.retryBlocked ? (
                  <Tag color="warning">需人工核对</Tag>
                ) : null}
              </Space>
              {target.reason ? (
                <span className={styles.targetReason}>{target.reason}</span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.detailSection}>
        <Space size={8} wrap>
          <Typography.Text strong>执行尝试</Typography.Text>
          <Typography.Text type="secondary">
            按发生顺序列出；后续尝试会追加记录，不覆盖已有证据。
          </Typography.Text>
        </Space>
        {notice.attempts.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚无执行尝试"
          />
        ) : (
          <div className={styles.attemptList}>
            {notice.attempts.map((attempt) => (
              <AttemptCard
                key={attempt.id}
                attempt={attempt}
                groupNameMap={groupNameMap}
              />
            ))}
          </div>
        )}
      </section>
    </Space>
  );
}

function AttemptCard({
  attempt,
  groupNameMap,
}: {
  attempt: MaintenanceAttempt;
  groupNameMap: Map<number, string>;
}) {
  return (
    <div className={styles.attemptCard}>
      <div className={styles.attemptHeader}>
        <Space size={8} wrap>
          <Typography.Text strong>尝试 #{attempt.number}</Typography.Text>
          <Tag color={phaseColor(attempt.phase)}>
            {phaseLabel(attempt.phase)}
          </Tag>
          <Tag color={attempt.executed ? "blue" : "default"}>
            {attempt.executed ? "已执行" : "未执行"}
          </Tag>
          {attempt.requiresReconciliation ? (
            <Tag color="warning">需人工核对</Tag>
          ) : null}
        </Space>
        <span className={styles.requestId}>{attempt.requestId}</span>
      </div>

      <div className={styles.attemptMeta}>
        <span>审计原因：{attempt.auditReason}</span>
        <span>开始：{formatMaintenanceTimestamp(attempt.startedAt)}</span>
        <span>结束：{formatMaintenanceTimestamp(attempt.endedAt)}</span>
        <span>
          目标快照：{attempt.targetGroupIds.length} 个（按提交顺序）
        </span>
      </div>

      <Space size={6} wrap>
        <Tag>成功 {attempt.totals.success}</Tag>
        <Tag>失败 {attempt.totals.failed}</Tag>
        <Tag>未调用平台发送 {attempt.totals.unreachable}</Tag>
        <Tag>结果未知 {attempt.totals.unknown}</Tag>
        <Tag>快照总数 {attempt.totals.total}</Tag>
      </Space>

      {attempt.requestError ? (
        <Alert
          showIcon
          type="error"
          title="请求级错误"
          description={
            attempt.remainingSeconds !== null
              ? `${attempt.requestError}（剩余冷却 ${attempt.remainingSeconds} 秒）`
              : attempt.requestError
          }
        />
      ) : null}

      {attempt.phase === "queued" ? (
        <Typography.Text type="secondary">
          排队等待 Worker 领取，尚无逐群结果。
        </Typography.Text>
      ) : attempt.phase === "running" ? (
        <Typography.Text type="secondary">
          Worker 正在发送，尚未写入逐群结果。
        </Typography.Text>
      ) : (
        <div className={styles.evidenceList}>
          {attempt.results.length === 0 ? (
            <Typography.Text type="secondary">
              该次请求未执行发送，没有逐群结果；请查看请求级错误。
            </Typography.Text>
          ) : (
            attempt.results.map((result) => (
              <div key={result.groupId} className={styles.evidenceRow}>
                <div className={styles.targetName}>
                  <span>
                    {groupNameMap.get(result.groupId) ?? "未知群聊"}
                  </span>
                  <span className={styles.targetId}>{result.groupId}</span>
                </div>
                <Tag color={outcomeColor(result.outcome)}>
                  {getMaintenanceOutcomeLabel(result.outcome)}
                </Tag>
                <span className={styles.evidenceDetail}>
                  {result.reason}
                  {result.errorCode
                    ? ` · error_code=${result.errorCode}`
                    : ""}
                  {result.error ? ` · ${result.error}` : ""}
                  {result.botId ? ` · bot_id=${result.botId}` : ""}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function describeCancelConflict(conflict: CancelConflict) {
  if (!conflict.currentNotice) {
    return `${conflict.message} 请刷新后重试。`;
  }

  const statusLabel = getMaintenanceNoticeStatusLabel(
    conflict.currentNotice.status,
    conflict.currentNotice.activity,
  );

  return `${conflict.message} 当前状态：${statusLabel}，版本 ${conflict.currentNotice.version}。列表与详情已刷新。`;
}

function phaseLabel(phase: MaintenanceAttemptPhase) {
  switch (phase) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "completed":
      return "已完成";
  }
}

function phaseColor(phase: MaintenanceAttemptPhase) {
  return phase === "running"
    ? "processing"
    : phase === "queued"
      ? "default"
      : "success";
}

function outcomeColor(outcome: MaintenanceOutcome | null) {
  switch (outcome) {
    case "success":
      return "success";
    case "failed":
      return "error";
    case "unreachable":
      return "default";
    case "unknown":
      return "warning";
    default:
      return "default";
  }
}
