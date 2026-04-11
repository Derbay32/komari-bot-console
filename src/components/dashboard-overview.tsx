"use client";

import {
  Alert,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/http/client";

type ListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

type ReplyLogListItem = {
  date: string;
  line_number: number;
  timestamp: string;
  method: string;
  model: string;
  phase?: string;
  duration_ms?: number | null;
  status: "success" | "error";
};

const moduleCards = [
  {
    title: "知识库",
    description: "负责管理关键词、分类与文本知识条目。",
    endpoint: "/api/komari-knowledge/v1/knowledge",
    tags: ["列表", "详情", "搜索"],
  },
  {
    title: "记忆中心",
    description: "管理对话、用户画像和互动历史。",
    endpoint: "/api/komari-memory/v1/conversations",
    tags: ["会话", "画像", "交互记录"],
  },
  {
    title: "回复日志",
    description: "查看模型调用摘要、耗时与失败信息。",
    endpoint: "/api/llm-provider/v1/reply-logs",
    tags: ["日志", "追踪", "排错"],
  },
];

export function DashboardOverview() {
  const overviewQuery = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: async () => {
      const [knowledge, conversations, profiles, logs] = await Promise.all([
        apiFetch<ListResponse<unknown>>("/api/komari-knowledge/v1/knowledge", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<ListResponse<unknown>>("/api/komari-memory/v1/conversations", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<ListResponse<unknown>>("/api/komari-memory/v1/user-profiles", {
          params: { limit: 1, offset: 0 },
        }),
        apiFetch<ListResponse<ReplyLogListItem>>("/api/llm-provider/v1/reply-logs", {
          params: { limit: 5, offset: 0 },
        }),
      ]);

      return {
        knowledgeTotal: knowledge.total,
        conversationTotal: conversations.total,
        profileTotal: profiles.total,
        latestLogs: logs.items,
      };
    },
  });

  return (
    <Space direction="vertical" size={16} style={{ display: "flex" }}>
      <Card className="glass-card" variant="borderless">
        <Space direction="vertical" size={6}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            管理后台已经起好骨架
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }} className="subtle-text">
            现在已经具备布局、全局主题、TanStack Query 数据层、服务端代理和 OpenAPI
            同步脚本，后续可以直接往业务页面填内容。
          </Typography.Paragraph>
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
        {[
          {
            title: "知识条目",
            value: overviewQuery.data?.knowledgeTotal ?? 0,
            loading: overviewQuery.isPending,
          },
          {
            title: "对话数量",
            value: overviewQuery.data?.conversationTotal ?? 0,
            loading: overviewQuery.isPending,
          },
          {
            title: "用户画像",
            value: overviewQuery.data?.profileTotal ?? 0,
            loading: overviewQuery.isPending,
          },
          {
            title: "最近日志",
            value: overviewQuery.data?.latestLogs.length ?? 0,
            loading: overviewQuery.isPending,
          },
        ].map((item) => (
          <Col xs={24} sm={12} xl={6} key={item.title}>
            <Card className="glass-card module-card" variant="borderless">
              <Statistic
                title={item.title}
                value={item.value}
                loading={item.loading}
                valueStyle={{ color: "#173156" }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            className="glass-card"
            title="模块接入规划"
            variant="borderless"
            extra={<Tag color="blue">已预留代理通道</Tag>}
          >
            <Row gutter={[16, 16]}>
              {moduleCards.map((module) => (
                <Col xs={24} md={12} xl={8} key={module.title}>
                  <Card className="module-card" variant="borderless">
                    <Space direction="vertical" size={12} style={{ display: "flex" }}>
                      <div>
                        <Typography.Title level={5} style={{ marginBottom: 8 }}>
                          {module.title}
                        </Typography.Title>
                        <Typography.Paragraph className="subtle-text" style={{ margin: 0 }}>
                          {module.description}
                        </Typography.Paragraph>
                      </div>
                      <Typography.Text code>{module.endpoint}</Typography.Text>
                      <Space wrap>
                        {module.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </Space>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            className="glass-card"
            title="环境约定"
            variant="borderless"
            extra={<Tag color="green">可直接扩展</Tag>}
          >
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="代理入口">
                <Typography.Text code>/api/proxy/*</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="后端来源">
                <Typography.Text className="subtle-text">
                  优先读取环境变量，其次读取本地 `secret.json`
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="类型生成">
                <Typography.Text code>npm run gen:api</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="开发入口">
                <Typography.Text code>npm run dev</Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Card
        className="glass-card"
        title="最近 Reply 日志"
        variant="borderless"
        extra={<Tag color="purple">联调示例</Tag>}
      >
        {overviewQuery.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : overviewQuery.data?.latestLogs.length ? (
          <List
            dataSource={overviewQuery.data.latestLogs}
            renderItem={(item) => (
              <List.Item>
                <div className="log-item">
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
              </List.Item>
            )}
          />
        ) : (
          <Empty description="暂无日志数据" />
        )}
      </Card>
    </Space>
  );
}
