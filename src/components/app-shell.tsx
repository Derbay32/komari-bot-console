"use client";

import {
  ApiOutlined,
  BookOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Badge, Button, Layout, Menu, Space, Tag, Typography } from "antd";

const { Content, Header, Sider } = Layout;

const menuItems = [
  {
    key: "overview",
    icon: <RobotOutlined />,
    label: "总览",
  },
  {
    key: "knowledge",
    icon: <BookOutlined />,
    label: "知识库",
  },
  {
    key: "memory",
    icon: <DatabaseOutlined />,
    label: "记忆中心",
  },
  {
    key: "logs",
    icon: <ClockCircleOutlined />,
    label: "回复日志",
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Layout className="console-shell">
      <Sider breakpoint="lg" collapsedWidth="0" width={252} className="console-sider">
        <div className="console-brand">
          <Space direction="vertical" size={12}>
            <div className="console-logo">
              <RobotOutlined />
            </div>
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                Komari Console
              </Typography.Title>
              <Typography.Text className="subtle-text">
                管理知识、记忆与 LLM 行为
              </Typography.Text>
            </div>
          </Space>
        </div>
        <Menu
          mode="inline"
          selectedKeys={["overview"]}
          items={menuItems}
          style={{
            borderInlineEnd: "none",
            background: "transparent",
            padding: "8px 12px 20px",
          }}
        />
      </Sider>
      <Layout className="console-main">
        <Header className="console-header">
          <Space direction="vertical" size={4}>
            <Space wrap>
              <Badge status="processing" />
              <Typography.Text strong>管理后台初始化完成</Typography.Text>
              <Tag color="blue" icon={<ApiOutlined />}>
                App Router + BFF Proxy
              </Tag>
            </Space>
            <Typography.Text className="subtle-text">
              浏览器只访问本地 Next.js，Bearer Token 保留在服务端代理层。
            </Typography.Text>
          </Space>
          <Space wrap>
            <Tag color="gold" icon={<SafetyCertificateOutlined />}>
              本地密钥优先
            </Tag>
            <Button type="primary">开始接业务页面</Button>
          </Space>
        </Header>
        <Content className="console-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
