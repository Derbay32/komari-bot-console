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
        colorPrimary: "#1668dc",
        borderRadius: 14,
        colorBgLayout: isDark ? "#111827" : "#eef3fb",
        fontFamily:
          '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
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
