"use client";

import {
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Space,
  Skeleton,
  Tag,
  Typography,
} from "antd";
import { useCallback, useMemo, useState } from "react";

import { observeCallback } from "@/lib/async";
import { AnnounceComposeModal } from "@/components/announce/announce-compose-modal";
import { AnnounceDetailsModal } from "@/components/announce/announce-details-modal";
import styles from "@/components/announce/announce.module.css";
import { getRequestErrorMessage } from "@/lib/http/error";
import { useAnnouncementList } from "@/lib/hooks/use-announce";
import {
  describeMaintenanceAggregate,
  formatMaintenanceTimestamp,
  getMaintenanceNoticeStatusLabel,
  type MaintenanceNoticeSummary,
} from "@/lib/maintenance";

export function AnnouncePage() {
  const [composeOpen, setComposeOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const listQuery = useAnnouncementList();
  const notices = useMemo(
    () => listQuery.data?.notices ?? [],
    [listQuery.data?.notices],
  );
  const upcoming = useMemo(
    () => notices.filter((notice) => notice.status === "upcoming"),
    [notices],
  );
  const history = useMemo(
    () => notices.filter((notice) => notice.status !== "upcoming"),
    [notices],
  );

  const handleRefresh = useCallback(async () => {
    await listQuery.refetch();
  }, [listQuery]);

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <div className="page-header">
        <div className="page-header__main">
          <Typography.Title level={2} className="page-title">
            公告通知
          </Typography.Title>
          <p className="page-description">
            创建维护通知任务，由独立 Worker 从本地数据库领取并发送。
          </p>
        </div>
        <Space className="page-header__actions" wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={observeCallback(handleRefresh)}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setComposeOpen(true)}
          >
            新增通知
          </Button>
        </Space>
      </div>

      {listQuery.isError ? (
        <Alert
          showIcon
          type="error"
          title="通知列表加载失败"
          description={getRequestErrorMessage(
            listQuery.error,
            "请稍后重试。",
          )}
          action={
            <Button size="small" onClick={observeCallback(handleRefresh)}>
              重试
            </Button>
          }
        />
      ) : null}

      <Card
        className="glass-card"
        variant="borderless"
        title={`待发送（${upcoming.length}）`}
      >
        <NoticeList
          notices={upcoming}
          loading={listQuery.isPending}
          emptyDescription="暂无待发送的维护通知"
          onOpen={setViewingId}
        />
      </Card>

      <Card
        className="glass-card"
        variant="borderless"
        title={`发送历史（${history.length}）`}
      >
        <NoticeList
          notices={history}
          loading={listQuery.isPending}
          emptyDescription="暂无发送历史"
          onOpen={setViewingId}
        />
      </Card>

      <AnnounceComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
      />
      {editingId !== null ? (
        <AnnounceComposeModal
          key={editingId}
          open
          editNoticeId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
      <AnnounceDetailsModal
        noticeId={viewingId}
        onClose={() => setViewingId(null)}
        onEdit={(notice) => {
          setViewingId(null);
          setEditingId(notice.id);
        }}
      />
    </Space>
  );
}

function NoticeList({
  notices,
  loading,
  emptyDescription,
  onOpen,
}: {
  notices: MaintenanceNoticeSummary[];
  loading: boolean;
  emptyDescription: string;
  onOpen: (id: string) => void;
}) {
  if (loading) {
    return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  }

  if (notices.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className={styles.noticeList}>
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          className={styles.noticeRow}
          onClick={() => onOpen(notice.id)}
        >
          <span className={styles.noticeMain}>
            <span className={styles.noticeTitleLine}>
              <span className={styles.noticeTitle}>{notice.title}</span>
              <StatusTag notice={notice} />
            </span>
            <span className={styles.noticeMeta}>
              维护时间：{notice.maintenanceTime}
            </span>
            {notice.mode === "scheduled" && notice.plannedAt !== null ? (
              <span className={styles.noticeMeta}>
                {notice.status === "missed" || notice.status === "canceled"
                  ? "原计划发送："
                  : "计划发送："}
                {formatMaintenanceTimestamp(notice.plannedAt)}（UTC+8）
              </span>
            ) : null}
            {notice.status === "canceled" ? (
              <span className={styles.noticeMeta}>
                取消时间：{formatMaintenanceTimestamp(notice.endedAt)}
              </span>
            ) : null}
            <span className={styles.noticeMeta}>
              {notice.status === "missed" || notice.status === "canceled"
                ? "未执行，无逐群发送结果"
                : describeMaintenanceAggregate(notice.aggregate)}
            </span>
            <span className={styles.noticeMeta}>
              目标群 {notice.groupIds.length} 个 · 创建于{" "}
              {formatMaintenanceTimestamp(notice.createdAt)}
            </span>
          </span>
          <span className={styles.noticeAction}>
            <Typography.Text type="secondary">查看详情</Typography.Text>
            <RightOutlined />
          </span>
        </button>
      ))}
    </div>
  );
}

function StatusTag({ notice }: { notice: MaintenanceNoticeSummary }) {
  const label = getMaintenanceNoticeStatusLabel(
    notice.status,
    notice.activity,
  );
  const color = notice.status === "sent" ? "success" : "default";

  return (
    <span className={styles.noticeTags}>
      <Tag color={color}>{label}</Tag>
      {notice.status === "missed" ? (
        <Tag color="warning">未执行</Tag>
      ) : null}
      {notice.status === "canceled" ? <Tag>未执行</Tag> : null}
      {notice.activity === "running" ? (
        <Tag color="processing">Worker 正在执行</Tag>
      ) : null}
      {notice.aggregate.requiresReconciliation ? (
        <Tag color="warning">需人工核对</Tag>
      ) : null}
    </span>
  );
}
