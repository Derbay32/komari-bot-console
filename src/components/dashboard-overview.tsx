"use client";

import {
  Alert,
  Card,
  Col,
  Empty,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";

import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type ConversationListResponse = components["schemas"]["ConversationListResponse"];
type KnowledgeListResponse = components["schemas"]["KnowledgeListResponse"];
type MemoryEntityListResponse = components["schemas"]["MemoryEntityListResponse"];
type ReplyLogListResponse = components["schemas"]["ReplyLogListResponse"];

type OverviewCardItem = {
  href: Route;
  loading: boolean;
  title: string;
  value: number;
};

export function DashboardOverview() {
  const overviewQuery = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: async () => {
      const [knowledge, conversations, profiles, llm_logs] = await Promise.all([
        apiFetch<KnowledgeListResponse>("/api/komari-knowledge/v1/knowledge", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<ConversationListResponse>("/api/komari-memory/v1/conversations", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<MemoryEntityListResponse>("/api/komari-memory/v1/user-profiles", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<ReplyLogListResponse>("/api/llm-provider/v1/reply-logs", {
          params: { limit: 5, offset: 0 },
        }),
      ]);

      return {
        knowledgeTotal: knowledge.total,
        conversationTotal: conversations.total,
        profileTotal: profiles.total,
        latestLogs: llm_logs.items,
      };
    },
  });

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <Card className="glass-card" variant="borderless">
        <Space orientation="vertical" size={6}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Komari-bot 管理后台
          </Typography.Title>
        </Space>
      </Card>

      {overviewQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          message="接口联调暂时失败"
          description={
            overviewQuery.error instanceof Error
              ? overviewQuery.error.message
              : "请检查本地 secret.json 或环境变量配置。"
          }
        />
      ) : null}

      <Row gutter={[16, 16]} className="status-grid">
        {buildOverviewCardItems({
          conversationTotal: overviewQuery.data?.conversationTotal ?? 0,
          knowledgeTotal: overviewQuery.data?.knowledgeTotal ?? 0,
          latestLogCount: overviewQuery.data?.latestLogs.length ?? 0,
          loading: overviewQuery.isPending,
          profileTotal: overviewQuery.data?.profileTotal ?? 0,
        }).map((item) => (
          <Col xs={24} sm={12} xl={6} key={item.title}>
            <Link href={item.href}>
              <Card className="glass-card module-card" variant="borderless" hoverable>
                <Statistic
                  title={item.title}
                  value={item.value}
                  loading={item.loading}
                  styles={{ content: { color: "var(--text-main)" } }}
                />
              </Card>
            </Link>
          </Col>
        ))}
      </Row>

      <Card
        className="glass-card"
        title="最近 Reply 日志"
        variant="borderless"
      >
        {overviewQuery.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : overviewQuery.data?.latestLogs.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {overviewQuery.data.latestLogs.map((item) => (
              <div
                key={`${item.date}-${item.line_number}`}
                className="log-item"
                style={{ padding: "12px 0", borderBottom: "1px solid var(--border-soft)" }}
              >
                <Tag color={item.status === "success" ? "success" : "error"}>
                  {item.status}
                </Tag>
                <div className="log-item__meta">
                  <Typography.Text strong>
                    {item.method} · {item.model}
                  </Typography.Text>
                  <div className="log-item__line">
                    {item.timestamp} · {item.phase || "未标记阶段"} · 行号 {item.line_number}
                    {typeof item.duration_ms === "number"
                      ? ` · ${Math.round(item.duration_ms)}ms`
                      : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="暂无日志数据" />
        )}
      </Card>
    </Space>
  );
}

function buildOverviewCardItems(params: {
  conversationTotal: number;
  knowledgeTotal: number;
  latestLogCount: number;
  loading: boolean;
  profileTotal: number;
}): OverviewCardItem[] {
  return [
    {
      title: "知识条目",
      value: params.knowledgeTotal,
      loading: params.loading,
      href: "/knowledge" as Route,
    },
    {
      title: "对话数量",
      value: params.conversationTotal,
      loading: params.loading,
      href: "/memory" as Route,
    },
    {
      title: "用户画像",
      value: params.profileTotal,
      loading: params.loading,
      href: "/memory" as Route,
    },
    {
      title: "最近日志",
      value: params.latestLogCount,
      loading: params.loading,
      href: "/llm_logs" as Route,
    },
  ];
}
