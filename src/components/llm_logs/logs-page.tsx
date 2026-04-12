"use client";

import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
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

export function LogsPage() {
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
    { title: "Method", dataIndex: "method", width: 100 },
    { title: "Model", dataIndex: "model", width: 140, ellipsis: true },
    { title: "Phase", dataIndex: "phase", width: 100 },
    {
      title: "Trace ID",
      dataIndex: "trace_id",
      width: 160,
      ellipsis: true,
      render: (v: string) => v || "-",
    },
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
      title: "Input",
      dataIndex: "input_preview",
      ellipsis: true,
      render: (v: string) => v || "-",
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
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <Card className="glass-card" variant="borderless">
        <Space wrap>
          <DatePicker
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
            placeholder="最近 N 天"
            min={1}
            max={365}
            value={filters.days}
            onChange={(v) => {
              setPage(1);
              setFilters((f) => ({ ...f, days: v ?? undefined }));
            }}
            style={{ width: 120 }}
          />
          <Input
            placeholder="Trace ID"
            allowClear
            value={filters.trace_id}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, trace_id: e.target.value || undefined }));
            }}
            style={{ width: 180 }}
          />
          <Input
            placeholder="Model"
            allowClear
            value={filters.model}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, model: e.target.value || undefined }));
            }}
            style={{ width: 140 }}
          />
          <Input
            placeholder="Method"
            allowClear
            value={filters.method}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, method: e.target.value || undefined }));
            }}
            style={{ width: 120 }}
          />
          <Select
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
            style={{ width: 100 }}
          />
        </Space>
      </Card>

      {listQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          message="回复日志加载失败"
          description={
            listQuery.error instanceof Error
              ? listQuery.error.message
              : "请稍后重试。"
          }
        />
      ) : null}

      <Card className="glass-card" variant="borderless">
        <Table<ReplyLogListItem>
          rowKey={(r) => `${r.date}-${r.line_number}`}
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total ?? 0,
            showSizeChanger: true,
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
        size={720}
      >
        {detailQuery.isPending && <Typography.Text>加载中...</Typography.Text>}
        {detailQuery.isError ? (
          <Alert
            showIcon
            type="error"
            message="日志详情加载失败"
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
        { label: "Date", value: detail.date },
        { label: "Line Number", value: String(detail.line_number) },
        { label: "Timestamp", value: new Date(detail.timestamp).toLocaleString("zh-CN") },
        { label: "Method", value: detail.method },
        { label: "Model", value: detail.model },
        { label: "Trace ID", value: detail.trace_id || "-" },
        { label: "Phase", value: detail.phase || "-" },
        {
          label: "Duration",
          value: typeof detail.duration_ms === "number" ? `${Math.round(detail.duration_ms)}ms` : "-",
        },
      ].map((item) => (
        <div key={item.label}>
          <Typography.Text strong>{item.label}: </Typography.Text>
          <Typography.Text>{item.value}</Typography.Text>
        </div>
      ))}

      <div>
        <Typography.Text strong>Status: </Typography.Text>
        <Tag color={detail.status === "success" ? "success" : "error"}>
          {detail.status}
        </Tag>
      </div>

      <div>
        <Typography.Text strong>Input Preview:</Typography.Text>
        <pre style={codeBlockStyle}>{detail.input_preview || "(空)"}</pre>
      </div>

      <div>
        <Typography.Text strong>Output Preview:</Typography.Text>
        <pre style={codeBlockStyle}>{detail.output_preview || "(空)"}</pre>
      </div>

      {detail.error_preview && (
        <div>
          <Typography.Text strong>Error Preview:</Typography.Text>
          <pre style={{ ...codeBlockStyle, color: "#ff4d4f" }}>{detail.error_preview}</pre>
        </div>
      )}

      {detail.input !== undefined && (
        <div>
          <Typography.Text strong>Input (完整):</Typography.Text>
          <pre style={codeBlockStyle}>
            {typeof detail.input === "string"
              ? detail.input
              : JSON.stringify(detail.input, null, 2)}
          </pre>
        </div>
      )}

      {detail.output !== undefined && detail.output !== null && (
        <div>
          <Typography.Text strong>Output (完整):</Typography.Text>
          <pre style={codeBlockStyle}>{detail.output}</pre>
        </div>
      )}

      {detail.error !== undefined && detail.error !== null && (
        <div>
          <Typography.Text strong>Error (完整):</Typography.Text>
          <pre style={{ ...codeBlockStyle, color: "#ff4d4f" }}>{detail.error}</pre>
        </div>
      )}
    </div>
  );
}

const codeBlockStyle: React.CSSProperties = {
  background: "#f5f5f5",
  padding: 12,
  borderRadius: 8,
  overflow: "auto",
  maxHeight: 300,
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};
