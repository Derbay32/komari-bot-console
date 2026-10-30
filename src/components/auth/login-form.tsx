"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { observeCallback } from "@/lib/async";

type LoginFormValues = {
  password: string;
  username: string;
};

const FALLBACK_ERROR_MESSAGE = "登录失败，请稍后重试。";
const NETWORK_ERROR_MESSAGE = "登录失败，请检查网络连接后重试。";

export function LoginForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: LoginFormValues) {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/login", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
        body: JSON.stringify(values),
      });
      const payload = await readJsonBody(response);

      if (!response.ok) {
        setErrorMessage(readMessage(payload) ?? FALLBACK_ERROR_MESSAGE);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage(NETWORK_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form<LoginFormValues>
      layout="vertical"
      requiredMark={false}
      onFinish={observeCallback(handleSubmit)}
    >
      {errorMessage ? (
        <Form.Item>
          <Alert type="error" showIcon title={errorMessage} />
        </Form.Item>
      ) : null}
      <Form.Item
        label="用户名"
        name="username"
        rules={[{ required: true, message: "请输入管理员用户名" }]}
      >
        <Input
          autoComplete="username"
          maxLength={128}
          placeholder="管理员用户名"
          prefix={<UserOutlined />}
          size="large"
        />
      </Form.Item>
      <Form.Item
        label="密码"
        name="password"
        rules={[{ required: true, message: "请输入密码" }]}
      >
        <Input.Password
          autoComplete="current-password"
          maxLength={1024}
          placeholder="管理员密码"
          prefix={<LockOutlined />}
          size="large"
        />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0 }}>
        <Button block htmlType="submit" loading={submitting} size="large" type="primary">
          登录
        </Button>
      </Form.Item>
    </Form>
  );
}

async function readJsonBody(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function readMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const message = Reflect.get(payload, "message");
  return typeof message === "string" && message.trim() ? message : null;
}
