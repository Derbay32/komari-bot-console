"use client";

import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Grid,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from "antd";
import { useCallback, useState } from "react";

import type { components } from "@/types/komari-api";
import { useAgentRun, useAgentRunList } from "@/lib/hooks/use-agent-runs";

type AgentRunListItem = components["schemas"]["AgentRunListItem"];
type AgentRunDetail = components["schemas"]["AgentRunDetail"];

type TimelineNode = {
  type: "round" | "tool";
  index: number;
  timestamp?: string;
  data: Record<string, unknown>;
};

function formatTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}

function statusColor(status: string): string {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "cancelled":
      return "default";
    default:
      return "processing";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "success":
      return "成功";
    case "error":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function originLabel(origin: string): string {
  if (origin === "debug") {
    return "调试";
  }
  return origin === "normal" ? "正常" : origin;
}

function pickTimestamp(item: Record<string, unknown>): string | undefined {
  const candidate = item.started_at ?? item.timestamp;
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function pickToolLabel(data: Record<string, unknown>, index: number): string {
  const candidate = data.tool_name ?? data.name ?? data.method;
  return typeof candidate === "string" && candidate.trim() ? candidate : `#${index + 1}`;
}

function buildTimeline(detail: AgentRunDetail): TimelineNode[] {
  const nodes: TimelineNode[] = [
    ...(detail.rounds ?? []).map((item, index): TimelineNode => ({
      type: "round",
      index,
      timestamp: pickTimestamp(item),
      data: item,
    })),
    ...(detail.tool_executions ?? []).map((item, index): TimelineNode => ({
      type: "tool",
      index,
      timestamp: pickTimestamp(item),
      data: item,
    })),
  ];

  return nodes
    .map((node, order) => ({ node, order }))
    .sort((a, b) => {
      const at = a.node.timestamp ? Date.parse(a.node.timestamp) : Number.NaN;
      const bt = b.node.timestamp ? Date.parse(b.node.timestamp) : Number.NaN;
      const aValid = Number.isFinite(at);
      const bValid = Number.isFinite(bt);

      if (aValid && bValid) {
        return at - bt || a.order - b.order;
      }
      if (aValid) {
        return -1;
      }
      if (bValid) {
        return 1;
      }
      return a.order - b.order;
    })
    .map((entry) => entry.node);
}

export function LogsPage() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    date?: string;
    days?: number;
    run_type?: string;
    task_kind?: string;
    origin?: "normal" | "debug";
    trace_id?: string;
    model?: string;
    method?: string;
    status?: "success" | "error" | "cancelled";
  }>({});

  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);

  const listParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useAgentRunList(listParams);
  const detailQuery = useAgentRun(detailKey ?? undefined);

  const handleViewDetail = useCallback((record: AgentRunListItem) => {
    setDetailKey(record.run_id);
    setDetailDrawerOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailDrawerOpen(false);
    setDetailKey(null);
  }, []);

  const columns = [
    {
      title: "时间",
      dataIndex: "started_at",
      width: 180,
      render: (v: string) => formatTime(v),
    },
    { title: "运行类型", dataIndex: "run_type", width: 110, ellipsis: true },
    { title: "任务类型", dataIndex: "task_kind", width: 110, ellipsis: true },
    {
      title: "来源",
      dataIndex: "origin",
      width: 80,
      render: (v: "normal" | "debug") => (
        <Tag color={v === "debug" ? "orange" : "default"}>{originLabel(v)}</Tag>
      ),
    },
    {
      title: "模型",
      dataIndex: "models",
      width: 140,
      ellipsis: true,
      render: (v?: string[]) => (v?.length ? v.join(", ") : "-"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: "success" | "error" | "cancelled") => (
        <Tag color={statusColor(v)}>{statusLabel(v)}</Tag>
      ),
    },
    {
      title: "耗时",
      dataIndex: "duration_ms",
      width: 100,
      render: (v?: number | null) =>
        typeof v === "number" ? `${Math.round(v)}ms` : "-",
    },
    { title: "轮次", dataIndex: "round_count", width: 70 },
    { title: "工具", dataIndex: "tool_count", width: 70 },
    {
      title: "输出预览",
      dataIndex: "output_preview",
      ellipsis: true,
      render: (v?: string) => (v?.trim() ? v : "-"),
    },
    {
      title: "操作",
      width: 80,
      render: (_: unknown, record: AgentRunListItem) => (
        <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }} className="logs-page">
      <div className="page-header">
        <div className="page-header__main">
          <Typography.Title level={2} className="page-title">
            运行日志
          </Typography.Title>
          <p className="page-description">
            追踪每一次 Agent 运行的完整链路，排查多轮对话与工具调用
          </p>
        </div>
      </div>

      <Card className="glass-card logs-page__filters-card" variant="borderless">
        <Space wrap size={12} className="logs-page__filters">
          <DatePicker
            className="logs-page__filter-control logs-page__filter-control--date"
            placeholder="日期筛选"
            onChange={(_, ds) => {
              setPage(1);
              setFilters((f) => ({
                ...f,
                date: typeof ds === "string" ? ds : undefined,
              }));
            }}
          />
          <InputNumber
            className="logs-page__filter-control"
            placeholder="最近 N 天"
            min={1}
            max={365}
            value={filters.days}
            onChange={(v) => {
              setPage(1);
              setFilters((f) => ({ ...f, days: v ?? undefined }));
            }}
            style={{ width: isMobile ? "100%" : 120 }}
          />
          <Input
            className="logs-page__filter-control"
            placeholder="运行类型"
            allowClear
            value={filters.run_type}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, run_type: e.target.value || undefined }));
            }}
            style={{ width: isMobile ? "100%" : 140 }}
          />
          <Input
            className="logs-page__filter-control"
            placeholder="任务类型"
            allowClear
            value={filters.task_kind}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, task_kind: e.target.value || undefined }));
            }}
            style={{ width: isMobile ? "100%" : 140 }}
          />
          <Select<"normal" | "debug">
            className="logs-page__filter-control"
            placeholder="来源"
            allowClear
            value={filters.origin}
            onChange={(v) => {
              setPage(1);
              setFilters((f) => ({ ...f, origin: v }));
            }}
            options={[
              { value: "normal", label: "正常" },
              { value: "debug", label: "调试" },
            ]}
            style={{ width: isMobile ? "100%" : 100 }}
          />
          <Input
            className="logs-page__filter-control"
            placeholder="Trace ID"
            allowClear
            value={filters.trace_id}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, trace_id: e.target.value || undefined }));
            }}
            style={{ width: isMobile ? "100%" : 180 }}
          />
          <Input
            className="logs-page__filter-control"
            placeholder="Model"
            allowClear
            value={filters.model}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, model: e.target.value || undefined }));
            }}
            style={{ width: isMobile ? "100%" : 140 }}
          />
          <Input
            className="logs-page__filter-control"
            placeholder="Method"
            allowClear
            value={filters.method}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, method: e.target.value || undefined }));
            }}
            style={{ width: isMobile ? "100%" : 120 }}
          />
          <Select<"success" | "error" | "cancelled">
            className="logs-page__filter-control"
            placeholder="状态"
            allowClear
            value={filters.status}
            onChange={(v) => {
              setPage(1);
              setFilters((f) => ({ ...f, status: v }));
            }}
            options={[
              { value: "success", label: "成功" },
              { value: "error", label: "失败" },
              { value: "cancelled", label: "已取消" },
            ]}
            style={{ width: isMobile ? "100%" : 100 }}
          />
        </Space>
      </Card>

      {listQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          title="运行日志加载失败"
          description={
            listQuery.error instanceof Error
              ? listQuery.error.message
              : "请稍后重试。"
          }
        />
      ) : null}

      <Card className="glass-card logs-page__table-card" variant="borderless">
        <Table<AgentRunListItem>
          rowKey={(r) => r.run_id}
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 1400 }}
          size={isMobile ? "small" : "middle"}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total ?? 0,
            showSizeChanger: true,
            simple: isMobile,
            size: isMobile ? "small" : undefined,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      <Drawer
        open={detailDrawerOpen}
        title="运行详情"
        onClose={handleCloseDetail}
        placement={isMobile ? "bottom" : "right"}
        size={isMobile ? "78vh" : 720}
      >
        {detailQuery.isPending && <Typography.Text>加载中...</Typography.Text>}
        {detailQuery.isError ? (
          <Alert
            showIcon
            type="error"
            title="运行详情加载失败"
            description={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "请稍后重试。"
            }
          />
        ) : null}
        {detailQuery.data && <RunDetailContent detail={detailQuery.data} />}
      </Drawer>
    </Space>
  );
}

function RunDetailContent({ detail }: { detail: AgentRunDetail }) {
  const timelineNodes = buildTimeline(detail);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { label: "Run ID", value: detail.run_id },
          { label: "Trace ID", value: detail.trace_id },
          { label: "运行类型", value: detail.run_type },
          { label: "任务类型", value: detail.task_kind },
          { label: "来源", value: originLabel(detail.origin) },
          { label: "开始时间", value: formatTime(detail.started_at) },
          { label: "结束时间", value: formatTime(detail.finished_at) },
          { label: "耗时", value: `${detail.duration_ms}ms` },
          { label: "模型", value: detail.models?.join(", ") || "-" },
          { label: "方法", value: detail.methods?.join(", ") || "-" },
        ].map((item) => (
          <div key={item.label}>
            <Typography.Text strong>{item.label}: </Typography.Text>
            <Typography.Text>{item.value}</Typography.Text>
          </div>
        ))}
        <div>
          <Typography.Text strong>状态: </Typography.Text>
          <Tag color={statusColor(detail.status)}>{statusLabel(detail.status)}</Tag>
        </div>
      </div>

      {timelineNodes.length ? (
        <div>
          <div className="detail-section-title">运行时间线</div>
          <Timeline
            items={timelineNodes.map((node) => ({
              color: node.type === "round" ? "blue" : "green",
              content: (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <Typography.Text strong>
                    {node.type === "round"
                      ? `第 ${node.index + 1} 轮对话`
                      : `工具调用: ${pickToolLabel(node.data, node.index)}`}
                  </Typography.Text>
                  {node.timestamp ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatTime(node.timestamp)}
                    </Typography.Text>
                  ) : null}
                  <pre style={{ ...codeBlockStyle, maxHeight: 200 }}>
                    {JSON.stringify(node.data, null, 2)}
                  </pre>
                </div>
              ),
            }))}
          />
        </div>
      ) : null}

      {detail.errors?.length ? (
        <div>
          <div className="detail-section-title">错误记录</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {detail.errors.map((error, index) => (
              <pre
                key={index}
                style={{ ...codeBlockStyle, color: "var(--error-text)" }}
              >
                {JSON.stringify(error, null, 2)}
              </pre>
            ))}
          </div>
        </div>
      ) : null}

      {detail.input != null ? (
        <div>
          <div className="detail-section-title">输入</div>
          <pre style={codeBlockStyle}>{JSON.stringify(detail.input, null, 2)}</pre>
        </div>
      ) : null}

      {detail.output != null ? (
        <div>
          <div className="detail-section-title">输出</div>
          <pre style={codeBlockStyle}>{JSON.stringify(detail.output, null, 2)}</pre>
        </div>
      ) : null}

      {detail.error != null ? (
        <div>
          <div className="detail-section-title">错误</div>
          <pre style={{ ...codeBlockStyle, color: "var(--error-text)" }}>
            {JSON.stringify(detail.error, null, 2)}
          </pre>
        </div>
      ) : null}

      {detail.usage ? (
        <div>
          <div className="detail-section-title">Token 用量</div>
          <pre style={codeBlockStyle}>{JSON.stringify(detail.usage, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

const codeBlockStyle: React.CSSProperties = {
  background: "var(--code-bg)",
  border: "1px solid var(--code-border)",
  padding: 12,
  borderRadius: 8,
  overflow: "auto",
  maxHeight: 300,
  fontSize: 12,
  color: "var(--text-main)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};
