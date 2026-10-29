"use client";

import {
  CheckOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Pagination,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useCallback, useMemo, useReducer, useState } from "react";

import { AnnounceComposeModal } from "@/components/announce/announce-compose-modal";
import { AnnounceDetailsModal } from "@/components/announce/announce-details-modal";
import styles from "@/components/announce/announce.module.css";
import { observeCallback } from "@/lib/async";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useAnnouncementList,
  useGroupList,
} from "@/lib/hooks/use-announce";
import {
  formatMaintenanceTimestamp,
  getMaintenanceOutcomeLabel,
  type MaintenanceNoticeSummary,
} from "@/lib/maintenance";
import {
  ANNOUNCEMENT_PAGE_SIZE,
  INITIAL_ANNOUNCEMENT_LIST_STATE,
  buildAnnouncementListModel,
  getAnnouncementStatusView,
  getAnnouncementTimingView,
  reduceAnnouncementListState,
  type AnnouncementPage,
  type AnnouncementScope,
  type AnnouncementScopeOption,
} from "@/lib/maintenance-view";

const SCOPE_ALL_KEY = "all";

export function AnnouncePage() {
  const [composeOpen, setComposeOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [listState, dispatchListState] = useReducer(
    reduceAnnouncementListState,
    INITIAL_ANNOUNCEMENT_LIST_STATE,
  );
  const listQuery = useAnnouncementList();
  const groupsQuery = useGroupList();
  const notices = useMemo(
    () => listQuery.data?.notices ?? [],
    [listQuery.data?.notices],
  );
  const groups = useMemo(
    () => groupsQuery.data?.groups ?? [],
    [groupsQuery.data?.groups],
  );
  const model = useMemo(
    () =>
      buildAnnouncementListModel({
        groups,
        historyPage: listState.historyPage,
        notices,
        scope: listState.scope,
        upcomingPage: listState.upcomingPage,
      }),
    [groups, listState, notices],
  );
  const groupNames = useMemo(() => {
    const names = new Map<number, string>();

    model.scopeOptions.forEach((option) => {
      if (option.groupId !== null && option.hasKnownName) {
        names.set(option.groupId, option.name);
      }
    });

    return names;
  }, [model.scopeOptions]);

  const handleRefresh = useCallback(async () => {
    await listQuery.refetch();
  }, [listQuery]);

  const handleScopeSelect = useCallback((scope: AnnouncementScope) => {
    dispatchListState({ scope, type: "selectScope" });
    setFilterOpen(false);
  }, []);

  const handleUpcomingPage = useCallback((page: number) => {
    dispatchListState({ page, type: "setUpcomingPage" });
  }, []);

  const handleHistoryPage = useCallback((page: number) => {
    dispatchListState({ page, type: "setHistoryPage" });
  }, []);

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div className="page-header__main">
          <Typography.Title level={1} className="page-title">
            公告通知
          </Typography.Title>
          <p className="page-description">
            创建维护通知任务，由独立 Worker 从本地数据库领取并发送。
          </p>
        </div>
        <Space
          className={`page-header__actions ${styles.createActions}`}
          wrap
        >
          <Button
            className={styles.refreshButton}
            icon={<ReloadOutlined aria-hidden="true" />}
            onClick={observeCallback(handleRefresh)}
          >
            刷新
          </Button>
          <Button
            type="primary"
            size="large"
            className={styles.createButton}
            icon={<PlusOutlined aria-hidden="true" />}
            aria-label="新增通知"
            aria-haspopup="dialog"
            onClick={() => setComposeOpen(true)}
          >
            <span className={styles.createLabel}>新增通知</span>
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

      <div className={styles.layout}>
        <aside className={styles.railColumn} aria-label="群聊筛选">
          <div className={styles.railCard}>
            <div className={styles.railHeader}>
              <h2 className={styles.railTitle}>群聊筛选</h2>
            </div>
            <p className={styles.railHint}>
              数字为即将发送和发送历史的通知条数；跨群通知只计一次。
              筛选不会改变新增通知的接收群聊。
            </p>
            {groupsQuery.isError ? (
              <p className={styles.railWarning}>
                群列表加载失败，仅显示通知记录中的群号。
              </p>
            ) : null}
            <nav aria-label="按群聊筛选通知">
              <ul className={styles.railList}>
                {model.scopeOptions.map((option) => (
                  <li key={scopeToKey(option.scope)}>
                    <ScopeButton
                      option={option}
                      active={model.scope === option.scope}
                      onSelect={handleScopeSelect}
                    />
                  </li>
                ))}
              </ul>
            </nav>
            <p className={styles.railNote}>
              切换群聊只改变筛选范围，不会修改通知、发送结果或新增通知的接收群聊。
            </p>
          </div>
        </aside>

        <div className={styles.contentColumn}>
          <button
            type="button"
            className={`${styles.mobileFilterButton} ${
              model.scope === "all" ? "" : styles.mobileFilterButtonActive
            }`}
            aria-label="群聊筛选"
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            title="群聊筛选"
            onClick={() => setFilterOpen(true)}
          >
            <svg
              className={styles.mobileFilterIcon}
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M4 7h16M7 12h10M10 17h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className={styles.mobileSelector}>
            <label
              className={styles.selectorLabel}
              htmlFor="announce-group-scope"
            >
              群聊筛选
            </label>
            <Select<string>
              id="announce-group-scope"
              value={scopeToKey(model.scope)}
              onChange={(value) => handleScopeSelect(keyToScope(value))}
              options={model.scopeOptions.map((option) => ({
                label: `${option.name} · ${option.count} 条`,
                value: scopeToKey(option.scope),
              }))}
              style={{ width: "100%" }}
            />
            <p className={styles.mobileSelectorHint}>
              {groupsQuery.isError
                ? "群列表加载失败，仅显示通知记录中的群号。"
                : "选择群聊只改变筛选范围，不会修改新增通知的接收群聊或草稿。"}
            </p>
          </div>

          <section className={styles.scopeBar} aria-label="当前筛选范围">
            <div className={styles.scopeTitleRow}>
              <span className={styles.scopeEyebrow}>当前查看范围</span>
              <Tag
                color={model.scope === "all" ? "processing" : "magenta"}
                className={styles.scopeTag}
              >
                {model.scopeLabel}
              </Tag>
              <span className={styles.scopeCounts}>
                即将发送 {model.upcoming.total} 条 · 发送历史{" "}
                {model.history.total} 条
              </span>
            </div>
            <p className={styles.scopeDescription}>{model.scopeDescription}</p>
          </section>

          <NoticeSection
            title="即将发送"
            hint="按计划时间从早到晚"
            emptyText={
              model.scope === "all"
                ? "全部范围暂无即将发送的通知。"
                : `「${model.scopeLabel}」暂无即将发送的通知。`
            }
            failed={listQuery.isError && !listQuery.data}
            loading={listQuery.isPending}
            page={model.upcoming}
            scope={model.scope}
            groupNames={groupNames}
            onOpen={setViewingId}
            onPageChange={handleUpcomingPage}
          />

          <NoticeSection
            title="发送历史"
            hint="发送时间 / 计划时间从新到旧"
            emptyText={
              model.scope === "all"
                ? "全部范围暂无发送记录。"
                : `「${model.scopeLabel}」暂无发送记录。`
            }
            failed={listQuery.isError && !listQuery.data}
            loading={listQuery.isPending}
            page={model.history}
            scope={model.scope}
            groupNames={groupNames}
            onOpen={setViewingId}
            onPageChange={handleHistoryPage}
          />
        </div>
      </div>

      <Drawer
        open={filterOpen}
        placement="bottom"
        size="auto"
        title="群聊筛选"
        onClose={() => setFilterOpen(false)}
        classNames={{ body: styles.filterDrawerBody }}
      >
        <p className={styles.filterDrawerHint}>
          选择后立即应用筛选并关闭面板。只改变筛选范围，不会修改通知或新增通知的接收群聊。
        </p>
        {groupsQuery.isError ? (
          <p className={styles.filterDrawerHint}>
            群列表加载失败，仅显示通知记录中的群号。
          </p>
        ) : null}
        <nav aria-label="选择群聊筛选范围">
          <ul className={styles.filterList}>
            {model.scopeOptions.map((option) => {
              const active = model.scope === option.scope;

              return (
                <li key={scopeToKey(option.scope)}>
                  <button
                    type="button"
                    className={`${styles.filterOption} ${
                      active ? styles.filterOptionActive : ""
                    }`}
                    aria-pressed={active}
                    onClick={() => handleScopeSelect(option.scope)}
                  >
                    <span className={styles.filterOptionText}>
                      <span className={styles.filterOptionName}>
                        {option.name}
                      </span>
                      {option.groupId === null ? (
                        <span className={styles.filterOptionMeta}>
                          所有群聊
                        </span>
                      ) : option.hasKnownName ? (
                        <span className={styles.filterOptionMeta}>
                          {option.groupId}
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.filterOptionCount}>
                      {option.count}
                    </span>
                    <span
                      className={styles.filterOptionCheck}
                      aria-hidden="true"
                    >
                      {active ? <CheckOutlined /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </Drawer>

      <AnnounceComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
      />
      <AnnounceDetailsModal
        noticeId={viewingId}
        onClose={() => setViewingId(null)}
      />
    </div>
  );
}

function ScopeButton({
  option,
  active,
  onSelect,
}: {
  option: AnnouncementScopeOption;
  active: boolean;
  onSelect: (scope: AnnouncementScope) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.railButton} ${
        active ? styles.railButtonActive : ""
      }`}
      aria-pressed={active}
      onClick={() => onSelect(option.scope)}
    >
      <span className={styles.railItemText}>
        <span className={styles.railName}>{option.name}</span>
        {option.groupId === null ? (
          <span className={styles.railId}>所有群聊</span>
        ) : option.hasKnownName ? (
          <span className={styles.railId}>{option.groupId}</span>
        ) : null}
      </span>
      <span
        className={styles.railCount}
        title={`${option.count} 条目标通知`}
        aria-label={`${option.count} 条目标通知`}
      >
        {option.count}
      </span>
    </button>
  );
}

function NoticeSection({
  title,
  hint,
  emptyText,
  loading,
  failed,
  page,
  scope,
  groupNames,
  onOpen,
  onPageChange,
}: {
  title: string;
  hint: string;
  emptyText: string;
  loading: boolean;
  failed: boolean;
  page: AnnouncementPage<MaintenanceNoticeSummary>;
  scope: AnnouncementScope;
  groupNames: Map<number, string>;
  onOpen: (id: string) => void;
  onPageChange: (page: number) => void;
}) {
  return (
    <Card
      className={`glass-card ${styles.sectionCard}`}
      variant="borderless"
      title={
        <div className={styles.sectionTitle}>
          <h3 className={styles.sectionHeading}>{title}</h3>
          <Tag className={styles.countTag}>{page.total} 条</Tag>
        </div>
      }
      extra={<span className={styles.sectionHint}>{hint}</span>}
    >
      {loading ? (
        <div className={styles.loadingState}>
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        </div>
      ) : failed ? (
        <div className={styles.emptyState}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="通知列表加载失败，请重试。"
          />
        </div>
      ) : page.items.length === 0 ? (
        <div className={styles.emptyState}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={emptyText}
          />
        </div>
      ) : (
        <>
          <ul className={styles.noticeList}>
            {page.items.map((notice) => (
              <NoticeRow
                key={notice.id}
                notice={notice}
                scope={scope}
                groupNames={groupNames}
                onOpen={onOpen}
              />
            ))}
          </ul>
          {page.pageCount > 1 ? (
            <div className={styles.paginationRow}>
              <Pagination
                size="small"
                current={page.page}
                pageSize={ANNOUNCEMENT_PAGE_SIZE}
                total={page.total}
                showSizeChanger={false}
                onChange={onPageChange}
              />
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function NoticeRow({
  notice,
  scope,
  groupNames,
  onOpen,
}: {
  notice: MaintenanceNoticeSummary;
  scope: AnnouncementScope;
  groupNames: Map<number, string>;
  onOpen: (id: string) => void;
}) {
  const status = getAnnouncementStatusView(notice, scope);
  const timing = getAnnouncementTimingView(notice);
  const targetNames = notice.groupIds
    .map((groupId) => groupNames.get(groupId) ?? String(groupId))
    .join("、");
  const perGroupLine =
    scope === "all" &&
    notice.status === "sent" &&
    notice.aggregate.perGroup.length > 0
      ? notice.aggregate.perGroup
          .map(
            (target) =>
              `${groupNames.get(target.groupId) ?? target.groupId}：${getMaintenanceOutcomeLabel(target.outcome)}`,
          )
          .join(" · ")
      : null;

  return (
    <li className={styles.noticeRow}>
      <div className={styles.noticeMain}>
        <div className={styles.noticeTitleRow}>
          <h4 className={styles.noticeTitle}>{notice.title}</h4>
          <div className={styles.noticeTags}>
            <Tag color={status.color} className={styles.noticeTag}>
              {status.label}
            </Tag>
            <Tag className={styles.noticeTag}>
              {notice.mode === "immediate" ? "立即发送" : "定时发送"}
            </Tag>
            {status.requiresReconciliation ? (
              <Tag color="warning" className={styles.noticeTag}>
                需人工核对
              </Tag>
            ) : null}
          </div>
        </div>

        <p className={styles.noticeBody}>{notice.content}</p>

        <div className={styles.noticeMeta}>
          <span>
            目标群组：{targetNames}（{notice.groupIds.length} 个）
          </span>
          <span>
            {timing.label}：
            {timing.value === null ? (
              "未记录"
            ) : (
              <time dateTime={toDateTimeAttribute(timing.value)}>
                {formatMaintenanceTimestamp(timing.value)}
              </time>
            )}
          </span>
          {timing.plannedAt !== null ? (
            <span>
              计划发送：{formatMaintenanceTimestamp(timing.plannedAt)}
            </span>
          ) : null}
          {timing.note ? (
            <span className={styles.noticeMuted}>{timing.note}</span>
          ) : null}
          <span className={styles.noticeStatusLine}>
            {scope === "all" ? "聚合状态：" : "当前群结果："}
            {status.detail}
          </span>
          {perGroupLine ? (
            <span className={styles.noticeMuted}>
              按群结果：{perGroupLine}
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.noticeActions}>
        <Button
          type="link"
          aria-label={`查看通知：${notice.title}`}
          onClick={() => onOpen(notice.id)}
        >
          查看
        </Button>
      </div>
    </li>
  );
}

function scopeToKey(scope: AnnouncementScope): string {
  return scope === "all" ? SCOPE_ALL_KEY : String(scope);
}

function keyToScope(key: string): AnnouncementScope {
  return key === SCOPE_ALL_KEY ? "all" : Number(key);
}

function toDateTimeAttribute(value: number): string {
  return new Date(value).toISOString();
}
