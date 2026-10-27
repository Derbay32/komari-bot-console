"use client";

import { Alert, Card, Col, Row, Space, Statistic, Typography } from "antd";
import { BookOutlined, CommentOutlined, UserOutlined } from "@ant-design/icons";
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
      const [knowledge, conversations, profiles] = await Promise.all([
        apiFetch<KnowledgeListResponse>("/api/komari-knowledge/v1/knowledge", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<ConversationListResponse>("/api/komari-memory/v1/conversations", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<MemoryEntityListResponse>("/api/komari-memory/v1/user-profiles", {
          params: { limit: 1, offset: 0 },
        }),
      ]);

      return {
        knowledgeTotal: knowledge.total,
        conversationTotal: conversations.total,
        profileTotal: profiles.total,
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
    </Space>
  );
}

function buildOverviewCardItems(params: {
  conversationTotal: number;
  knowledgeTotal: number;
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
  ];
}
