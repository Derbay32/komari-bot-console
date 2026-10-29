"use client";

import { LogoutOutlined } from "@ant-design/icons";
import { App, Button } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { observeCallback, observePromise } from "@/lib/async";

export function LogoutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);

  async function handleLogout() {
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/logout", {
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });

      if (!response.ok && response.status !== 401) {
        observePromise(message.error("退出登录失败，请稍后重试。"));
        return;
      }

      queryClient.clear();
      router.replace("/login");
      router.refresh();
    } catch {
      observePromise(message.error("退出登录失败，请检查网络连接后重试。"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      block
      icon={<LogoutOutlined />}
      loading={submitting}
      type="text"
      onClick={observeCallback(handleLogout)}
    >
      退出登录
    </Button>
  );
}
