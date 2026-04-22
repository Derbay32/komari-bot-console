"use client";

import {
  BookOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  MenuOutlined,
  MoonOutlined,
  NotificationOutlined,
  RobotOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Grid, Layout, Menu, Segmented, Space, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { ItemType } from "antd/es/menu/interface";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";

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

const emptySubscribe = () => () => undefined;

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
  const { setTheme, theme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selectedKey = routeMap[pathname] ?? "overview";
  const pageTitle = titleMap[pathname] ?? "管理后台";
  const currentTheme =
    mounted && (theme === "light" || theme === "dark" || theme === "system")
      ? theme
      : "system";

  const navigationContent = (
    <>
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
        onClick={() => setMobileNavOpen(false)}
      />
    </>
  );

  return (
    <Layout className="console-shell">
      {isMobile ? (
        <Drawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          placement="left"
          size={288}
          className="console-nav-drawer"
          rootClassName="console-nav-drawer-root"
          closable={false}
        >
          {navigationContent}
        </Drawer>
      ) : (
        <Sider width={252} className="console-sider">
          {navigationContent}
        </Sider>
      )}
      <Layout className="console-main">
        <Header className="console-header">
          <div className="console-header__title-group">
            {isMobile ? (
              <Button
                type="text"
                size="large"
                icon={<MenuOutlined />}
                className="console-header__menu-btn"
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开导航菜单"
              />
            ) : null}
            <Typography.Title level={4} style={{ margin: 0 }}>
              {pageTitle}
            </Typography.Title>
          </div>
          <div className="console-header__actions">
            <Segmented<"light" | "dark" | "system">
              className="theme-toggle"
              block={!isMobile}
              value={currentTheme}
              onChange={(value) => setTheme(value)}
              options={[
                {
                  label: (
                    <span className="theme-toggle__option">
                      <SunOutlined />
                      <span className="theme-toggle__text">浅色</span>
                    </span>
                  ),
                  value: "light",
                },
                {
                  label: (
                    <span className="theme-toggle__option">
                      <MoonOutlined />
                      <span className="theme-toggle__text">深色</span>
                    </span>
                  ),
                  value: "dark",
                },
                {
                  label: (
                    <span className="theme-toggle__option">
                      <RobotOutlined />
                      <span className="theme-toggle__text">跟随系统</span>
                    </span>
                  ),
                  value: "system",
                },
              ]}
            />
          </div>
        </Header>
        <Content className="console-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
