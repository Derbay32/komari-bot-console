"use client";

import { Alert, Card, Col, Row, Space, Statistic, Typography } from "antd";
import { BookOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { D20Icon } from "@/components/brand-logo";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type KnowledgeListResponse = components["schemas"]["KnowledgeListResponse"];

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
      const knowledge = await apiFetch<KnowledgeListResponse>(
        "/api/v2/komari-knowledge/knowledge",
        { params: { limit: 1, offset: 0 } },
      );

      return {
        knowledgeTotal: knowledge.total,
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
        <Col xs={24} sm={12} xl={6}>
          <Link href="/knowledge">
            <Card className="glass-card module-card" variant="borderless">
              <div className="stat-card__icon stat-card__icon--rose">
                <BookOutlined />
              </div>
              <Statistic
                title="知识条目"
                value={overviewQuery.data?.knowledgeTotal ?? 0}
                loading={overviewQuery.isPending}
                styles={{ content: { color: "var(--text-main)", fontSize: 30 } }}
              />
            </Card>
          </Link>
        </Col>
      </Row>
    </Space>
  );
}
