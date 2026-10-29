"use client";

import {
  BellOutlined,
  BookOutlined,
  DeploymentUnitOutlined,
  HighlightOutlined,
  MenuOutlined,
  MoonOutlined,
  RobotOutlined,
  SettingOutlined,
  StopOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Layout, Menu, Segmented, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { ItemType } from "antd/es/menu/interface";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";

import { BrandLogo, D20Icon, DaisyIcon } from "@/components/brand-logo";

const { Content, Sider } = Layout;

const routeMap: Record<string, string> = {
  "/": "overview",
  "/knowledge": "knowledge",
  "/help": "help",
  "/announce": "announce",
  "/bans": "bans",
  "/prompt/main": "prompt-main",
  "/config": "config",
};

const CONFIG_ROUTE = "/config" as Route;
const ANNOUNCE_ROUTE = "/announce" as Route;
const BANS_ROUTE = "/bans" as Route;
const PROMPT_MAIN_ROUTE = "/prompt/main" as Route;
const HELP_ROUTE = "/help" as Route;

const emptySubscribe = () => () => undefined;
const MOBILE_PORTRAIT_QUERY = "(max-width: 767px) and (orientation: portrait)";

function subscribeToMobilePortrait(onChange: () => void) {
  const media = window.matchMedia(MOBILE_PORTRAIT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getMobilePortraitSnapshot() {
  return window.matchMedia(MOBILE_PORTRAIT_QUERY).matches;
}

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
      { key: "prompt-main", label: <Link href={PROMPT_MAIN_ROUTE}>主提示词</Link> },
    ],
  },
  {
    key: "config",
    icon: <SettingOutlined />,
    label: <Link href={CONFIG_ROUTE}>配置管理</Link>,
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setTheme, theme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const isMobilePortrait = useSyncExternalStore(
    subscribeToMobilePortrait,
    getMobilePortraitSnapshot,
    () => false,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selectedKey = routeMap[pathname] ?? "overview";
  const currentTheme =
    mounted && (theme === "light" || theme === "dark" || theme === "system")
      ? theme
      : "system";

  const themeToggle = (
    <Segmented<"light" | "dark" | "system">
      className="theme-toggle"
      shape="round"
      block
      aria-label="主题模式"
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
          title: "浅色",
        },
        {
          label: (
            <span className="theme-toggle__option">
              <MoonOutlined />
              <span className="theme-toggle__text">深色</span>
            </span>
          ),
          value: "dark",
          title: "深色",
        },
        {
          label: (
            <span className="theme-toggle__option">
              <RobotOutlined />
              <span className="theme-toggle__text">跟随系统</span>
            </span>
          ),
          value: "system",
          title: "跟随系统",
        },
      ]}
    />
  );

  const navigationContent = (
    <div className="console-sider__navigation">
      <div className="console-sider__scroll">
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
      </div>
      <div className="console-sider-deco" aria-hidden="true">
        <D20Icon size={120} className="console-sider-deco__dice" />
      </div>
    </div>
  );

  return (
    <Layout className="console-shell">
      <Drawer
        open={isMobilePortrait && mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        placement="left"
        size={288}
        className="console-nav-drawer"
        rootClassName="console-nav-drawer-root"
        closable={false}
        styles={{
          body: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: 0,
            overflow: "hidden",
          },
        }}
      >
        {navigationContent}
        <div className="console-sider__footer">{themeToggle}</div>
      </Drawer>
      <Sider width={252} className="console-sider">
        {navigationContent}
        <div className="console-sider__footer">{themeToggle}</div>
      </Sider>
      <Layout className="console-main">
        <Content className="console-content">
          <Button
            type="text"
            size="large"
            icon={<MenuOutlined />}
            className="console-mobile-menu-btn"
            onClick={() => setMobileNavOpen(true)}
            aria-label="打开导航菜单"
            aria-expanded={isMobilePortrait && mobileNavOpen}
          />
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
