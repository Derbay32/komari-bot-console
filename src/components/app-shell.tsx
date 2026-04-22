"use client";

import {
  BookOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  NotificationOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Layout, Menu, Space, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { ItemType } from "antd/es/menu/interface";

const { Content, Header, Sider } = Layout;

const routeMap: Record<string, string> = {
  "/": "overview",
  "/knowledge": "knowledge",
  "/help": "help",
  "/memory": "memory",
  "/announce": "announce",
  "/config": "config",
  "/llm_logs": "logs",
};

const titleMap: Record<string, string> = {
  "/": "总览",
  "/knowledge": "知识库",
  "/help": "帮助文档",
  "/memory": "记忆中心",
  "/announce": "公告通知",
  "/config": "配置管理",
  "/llm_logs": "回复日志",
};

const CONFIG_ROUTE = "/config" as Route;
const ANNOUNCE_ROUTE = "/announce" as Route;
const HELP_ROUTE = "/help" as Route;
const LOGS_ROUTE = "/llm_logs" as Route;

const menuItems: ItemType[] = [
  {
    key: "overview",
    icon: <RobotOutlined />,
    label: <Link href="/">总览</Link>,
  },
  {
    key: "knowledge",
    icon: <BookOutlined />,
    label: <Link href="/knowledge">知识库</Link>,
  },
  {
    key: "help",
    icon: <BookOutlined />,
    label: <Link href={HELP_ROUTE}>帮助文档</Link>,
  },
  {
    key: "memory",
    icon: <DatabaseOutlined />,
    label: <Link href="/memory">记忆中心</Link>,
  },
  {
    key: "announce",
    icon: <NotificationOutlined />,
    label: <Link href={ANNOUNCE_ROUTE}>公告通知</Link>,
  },
  {
    key: "config",
    icon: <SettingOutlined />,
    label: <Link href={CONFIG_ROUTE}>配置管理</Link>,
  },
  {
    key: "llm_logs",
    icon: <ClockCircleOutlined />,
    label: <Link href={LOGS_ROUTE}>回复日志</Link>,
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const selectedKey = routeMap[pathname] ?? "overview";
  const pageTitle = titleMap[pathname] ?? "管理后台";

  return (
    <Layout className="console-shell">
      <Sider breakpoint="lg" collapsedWidth="0" width={252} className="console-sider">
        <div className="console-brand">
          <Space orientation="vertical" size={12}>
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
          className="console-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
        />
      </Sider>
      <Layout className="console-main">
        <Header className="console-header">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {pageTitle}
          </Typography.Title>
        </Header>
        <Content className="console-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
