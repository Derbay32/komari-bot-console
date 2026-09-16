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
import {
  BookOutlined,
  CommentOutlined,
  FileTextOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { D20Icon } from "@/components/brand-logo";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type ConversationListResponse = components["schemas"]["ConversationListResponse"];
type KnowledgeListResponse = components["schemas"]["KnowledgeListResponse"];
type MemoryEntityListResponse = components["schemas"]["MemoryEntityListResponse"];
type AgentRunListResponse = components["schemas"]["AgentRunListResponse"];

function runStatusColor(status: string): string {
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

type OverviewCardItem = {
  href: Route;
  icon: ReactNode;
  iconClassName: string;
  loading: boolean;
  title: string;
  value: number;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

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
        apiFetch<AgentRunListResponse>("/api/agent-run-logs/v1/runs", {
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
      <Card className="dashboard-hero" variant="borderless">
        <D20Icon size={150} className="dashboard-hero__dice" />
        <Typography.Title level={3} className="dashboard-hero__title">
          今天也要掷出大成功哦
        </Typography.Title>
        <Typography.Text className="dashboard-hero__subtitle">
          {dateFormatter.format(new Date())} · Komari Bot 运转监视中
        </Typography.Text>
      </Card>

      {overviewQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          title="接口联调暂时失败"
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
              <Card className="glass-card module-card" variant="borderless">
                <div className={`stat-card__icon ${item.iconClassName}`}>{item.icon}</div>
                <Statistic
                  title={item.title}
                  value={item.value}
                  loading={item.loading}
                  styles={{ content: { color: "var(--text-main)", fontSize: 30 } }}
                />
              </Card>
            </Link>
          </Col>
        ))}
      </Row>

      <Card className="glass-card" title="最近运行日志" variant="borderless">
        {overviewQuery.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : overviewQuery.data?.latestLogs.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {overviewQuery.data.latestLogs.map((item) => (
              <div
                key={item.run_id}
                className="log-item dashboard-log-card"
              >
                <Tag color={runStatusColor(item.status)}>{item.status}</Tag>
                <div className="log-item__meta">
                  <Typography.Text strong>
                    {item.run_type} · {item.task_kind}
                  </Typography.Text>
                  <div className="log-item__line">
                    {item.started_at} · 来源 {item.origin} · {item.round_count} 轮 ·{" "}
                    {item.tool_count} 次工具调用
                    {typeof item.duration_ms === "number"
                      ? ` · ${Math.round(item.duration_ms)}ms`
                      : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="还、还没有日志数据……" />
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
      icon: <BookOutlined />,
      iconClassName: "stat-card__icon--rose",
    },
    {
      title: "对话数量",
      value: params.conversationTotal,
      loading: params.loading,
      href: "/memory" as Route,
      icon: <CommentOutlined />,
      iconClassName: "stat-card__icon--mauve",
    },
    {
      title: "用户画像",
      value: params.profileTotal,
      loading: params.loading,
      href: "/memory" as Route,
      icon: <UserOutlined />,
      iconClassName: "stat-card__icon--gold",
    },
    {
      title: "最近日志",
      value: params.latestLogCount,
      loading: params.loading,
      href: "/llm_logs" as Route,
      icon: <FileTextOutlined />,
      iconClassName: "stat-card__icon--green",
    },
  ];
}
