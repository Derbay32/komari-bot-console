"use client";

import { useMemo } from "react";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider, useTheme } from "next-themes";

import { getQueryClient } from "@/lib/query-client";

function ThemedAntdProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();

  const isDark = resolvedTheme === "dark";
  const antdTheme = useMemo(
    () => ({
      algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: isDark ? "#C76B7D" : "#943A4D",
        colorLink: isDark ? "#C76B7D" : "#943A4D",
        colorSuccess: isDark ? "#7FBE7E" : "#5B9E5A",
        colorWarning: isDark ? "#E8B450" : "#E3A93C",
        colorError: isDark ? "#E26875" : "#C93B4A",
        colorInfo: isDark ? "#C98A97" : "#B06B7A",
        borderRadius: 12,
        colorBgLayout: isDark ? "#1A1315" : "#F8ECEA",
        fontFamily:
          '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
      },
      components: {
        Table: {
          headerBg: isDark ? "#2C2024" : "#F9EFEA",
        },
      },
    }),
    [isDark],
  );

  return (
    <ConfigProvider
      locale={zhCN}
      input={{ autoComplete: "off" }}
      textArea={{ autoComplete: "off" }}
      theme={antdTheme}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <ThemedAntdProvider>{children}</ThemedAntdProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
