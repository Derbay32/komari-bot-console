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
  Typography,
} from "antd";
import { useCallback, useState } from "react";

import type { components } from "@/types/komari-api";
import { useReplyLog, useReplyLogList } from "@/lib/hooks/use-reply-logs";

type ReplyLogListItem = components["schemas"]["ReplyLogListItem"];
type ReplyLogDetail = components["schemas"]["ReplyLogDetail"];

function summarizeOutput(summary?: Record<string, unknown> | null): string {
  if (!summary) {
    return "-";
  }

  const text = summary.preview ?? summary.text ?? summary.content;
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }

  const json = JSON.stringify(summary);
  return json === "{}" ? "-" : json;
}

export function LogsPage() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    date?: string;
    days?: number;
    trace_id?: string;
    model?: string;
    method?: string;
    status?: "success" | "error";
  }>({});

  const [detailKey, setDetailKey] = useState<{
    date: string;
    line_number: number;
  } | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);

  const listParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useReplyLogList(listParams);
  const detailQuery = useReplyLog(detailKey?.date, detailKey?.line_number);

  const handleViewDetail = useCallback((record: ReplyLogListItem) => {
    setDetailKey({ date: record.date, line_number: record.line_number });
    setDetailDrawerOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailDrawerOpen(false);
    setDetailKey(null);
  }, []);

  const columns = [
    {
      title: "时间",
      dataIndex: "timestamp",
      width: 180,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    { title: "Model", dataIndex: "model", width: 140, ellipsis: true },
    {
      title: "耗时",
      dataIndex: "duration_ms",
      width: 100,
      render: (v?: number | null) =>
        typeof v === "number" ? `${Math.round(v)}ms` : "-",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: "success" | "error") => (
        <Tag color={v === "success" ? "success" : "error"}>{v}</Tag>
      ),
    },
    {
      title: "输出",
      dataIndex: "output_summary",
      ellipsis: true,
      render: (v: Record<string, unknown> | null | undefined) =>
        summarizeOutput(v),
    },
    {
      title: "操作",
      width: 80,
      render: (_: unknown, record: ReplyLogListItem) => (
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
            回复日志
          </Typography.Title>
          <p className="page-description">
            追踪每一次 LLM 调用的输入输出，排查小鞠的回复质量
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
          <Select
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
            ]}
            style={{ width: isMobile ? "100%" : 100 }}
          />
        </Space>
      </Card>

      {listQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          title="回复日志加载失败"
          description={
            listQuery.error instanceof Error
              ? listQuery.error.message
              : "请稍后重试。"
          }
        />
      ) : null}

      <Card className="glass-card logs-page__table-card" variant="borderless">
        <Table<ReplyLogListItem>
          rowKey={(r) => `${r.date}-${r.line_number}`}
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 1200 }}
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
        title="日志详情"
        onClose={handleCloseDetail}
        placement={isMobile ? "bottom" : "right"}
        size={isMobile ? "78vh" : 720}
      >
        {detailQuery.isPending && <Typography.Text>加载中...</Typography.Text>}
        {detailQuery.isError ? (
          <Alert
            showIcon
            type="error"
            title="日志详情加载失败"
            description={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "请稍后重试。"
            }
          />
        ) : null}
        {detailQuery.data && <LogDetailContent detail={detailQuery.data} />}
      </Drawer>
    </Space>
  );
}

function LogDetailContent({ detail }: { detail: ReplyLogDetail }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {[
        { label: "日期", value: detail.date },
        { label: "时间", value: new Date(detail.timestamp).toLocaleString("zh-CN") },
        { label: "方法", value: detail.method },
        { label: "模型", value: detail.model },
        { label: "Trace ID", value: detail.trace_id },
        { label: "阶段", value: detail.phase },
        {
          label: "耗时",
          value: typeof detail.duration_ms === "number" ? `${Math.round(detail.duration_ms)}ms` : "-",
        },
        {
          label: "工具调用数",
          value: typeof detail.tool_calls_count === "number" ? String(detail.tool_calls_count) : "-",
        },
        { label: "推理字符数", value: String(detail.reasoning_chars) },
      ].map((item) => (
        <div key={item.label}>
          <Typography.Text strong>{item.label}: </Typography.Text>
          <Typography.Text>{item.value}</Typography.Text>
        </div>
      ))}

      <div>
        <Typography.Text strong>状态: </Typography.Text>
        <Tag color={detail.status === "success" ? "success" : "error"}>
          {detail.status}
        </Tag>
      </div>

      {detail.input_summary ? (
        <div>
          <div className="detail-section-title">输入摘要</div>
          <pre style={codeBlockStyle}>
            {JSON.stringify(detail.input_summary, null, 2)}
          </pre>
        </div>
      ) : null}

      {detail.output_summary ? (
        <div>
          <div className="detail-section-title">输出摘要</div>
          <pre style={codeBlockStyle}>
            {JSON.stringify(detail.output_summary, null, 2)}
          </pre>
        </div>
      ) : null}

      {detail.error_summary ? (
        <div>
          <div className="detail-section-title">错误摘要</div>
          <pre style={{ ...codeBlockStyle, color: "var(--error-text)" }}>
            {JSON.stringify(detail.error_summary, null, 2)}
          </pre>
        </div>
      ) : null}

      {detail.usage ? (
        <div>
          <div className="detail-section-title">用量</div>
          <pre style={codeBlockStyle}>
            {JSON.stringify(detail.usage, null, 2)}
          </pre>
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
