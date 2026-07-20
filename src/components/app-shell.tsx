"use client";

import {
  BellOutlined,
  BookOutlined,
  DeploymentUnitOutlined,
  FileTextOutlined,
  HighlightOutlined,
  MenuOutlined,
  MoonOutlined,
  RobotOutlined,
  SettingOutlined,
  StopOutlined,
  SunOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Grid, Layout, Menu, Segmented, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { ItemType } from "antd/es/menu/interface";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";

import { BrandLogo, D20Icon, DaisyIcon } from "@/components/brand-logo";

const { Content, Header, Sider } = Layout;

const routeMap: Record<string, string> = {
  "/": "overview",
  "/knowledge": "knowledge",
  "/help": "help",
  "/memory": "memory",
  "/announce": "announce",
  "/bans": "bans",
  "/prompt/scenes": "prompt-scenes",
  "/prompt/main": "prompt-main",
  "/config": "config",
  "/llm_logs": "logs",
};

const titleMap: Record<string, string> = {
  "/": "总览",
  "/knowledge": "知识库",
  "/help": "帮助文档",
  "/memory": "记忆中心",
  "/announce": "公告通知",
  "/bans": "用户封禁",
  "/prompt/scenes": "决策场景",
  "/prompt/main": "主提示词",
  "/config": "配置管理",
  "/llm_logs": "回复日志",
};

const CONFIG_ROUTE = "/config" as Route;
const ANNOUNCE_ROUTE = "/announce" as Route;
const BANS_ROUTE = "/bans" as Route;
const SCENES_ROUTE = "/prompt/scenes" as Route;
const PROMPT_MAIN_ROUTE = "/prompt/main" as Route;
const HELP_ROUTE = "/help" as Route;
const LOGS_ROUTE = "/llm_logs" as Route;

const emptySubscribe = () => () => undefined;

const menuItems: ItemType[] = [
  {
    key: "overview",
    icon: <D20Icon size={15} />,
    label: <Link href="/">总览</Link>,
  },
  {
    key: "knowledge",
    icon: <BookOutlined />,
    label: <Link href="/knowledge">知识库</Link>,
  },
  {
    key: "help",
    icon: <HighlightOutlined />,
    label: <Link href={HELP_ROUTE}>帮助文档</Link>,
  },
  {
    key: "memory",
    icon: <TagOutlined />,
    label: <Link href="/memory">记忆中心</Link>,
  },
  {
    key: "announce",
    icon: <BellOutlined />,
    label: <Link href={ANNOUNCE_ROUTE}>公告通知</Link>,
  },
  {
    key: "bans",
    icon: <StopOutlined />,
    label: <Link href={BANS_ROUTE}>用户封禁</Link>,
  },
  {
    key: "prompt",
    icon: <DeploymentUnitOutlined />,
    label: "提示词管理",
    children: [
      { key: "prompt-scenes", label: <Link href={SCENES_ROUTE}>决策场景</Link> },
      { key: "prompt-main", label: <Link href={PROMPT_MAIN_ROUTE}>主提示词</Link> },
    ],
  },
  {
    key: "config",
    icon: <SettingOutlined />,
    label: <Link href={CONFIG_ROUTE}>配置管理</Link>,
  },
  {
    key: "logs",
    icon: <FileTextOutlined />,
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
        <DaisyIcon size={26} className="console-brand__daisy" />
        <div className="console-brand__row">
          <div className="console-logo">
            <BrandLogo size={44} />
          </div>
          <div className="console-brand__text">
            <Typography.Title level={4} className="console-brand__title">
              Komari Bot Console
            </Typography.Title>
            <Typography.Text className="console-brand__subtitle">
              負けヒロインが多すぎる！
            </Typography.Text>
          </div>
        </div>
      </div>
      <Menu
        className="console-menu"
        mode="inline"
        selectedKeys={[selectedKey]}
        defaultOpenKeys={["prompt"]}
        items={menuItems}
        onClick={() => setMobileNavOpen(false)}
      />
      <div className="console-sider-deco" aria-hidden="true">
        <D20Icon size={120} className="console-sider-deco__dice" />
      </div>
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
            <Typography.Title level={4} className="console-header__title">
              {pageTitle}
            </Typography.Title>
          </div>
          <div className="console-header__actions">
            <Segmented<"light" | "dark" | "system">
              className="theme-toggle"
              shape="round"
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
