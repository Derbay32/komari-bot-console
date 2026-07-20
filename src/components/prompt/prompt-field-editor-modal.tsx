"use client";

import { Form, Modal } from "antd";
import { useCallback, useState } from "react";
import { useTheme } from "next-themes";

import { AuditReasonFormItem } from "@/components/audit-reason-form-item";
import { MonacoEditor } from "@/components/monaco-editor";

type PromptFieldFormValues = {
  auditReason: string;
};

interface PromptFieldEditorModalProps {
  open: boolean;
  title: string;
  value: string;
  onCancel: () => void;
  onOk: (value: string, auditReason: string) => Promise<void>;
  confirmLoading?: boolean;
}

export function PromptFieldEditorModal({
  open,
  title,
  value,
  onCancel,
  onOk,
  confirmLoading,
}: PromptFieldEditorModalProps) {
  const { resolvedTheme } = useTheme();
  const [form] = Form.useForm<PromptFieldFormValues>();
  const [text, setText] = useState(value);

  const handleChange = useCallback((val: string | undefined) => {
    setText(val ?? "");
  }, []);

  const handleOk = useCallback(async () => {
    let values: PromptFieldFormValues;

    try {
      values = await form.validateFields();
    } catch {
      // 校验失败时 antd 已展示错误信息，直接中断提交
      return;
    }

    await onOk(text, values.auditReason);
  }, [form, onOk, text]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setText(value);
        form.resetFields();
      }
    },
    [form, value],
  );

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      width={720}
      destroyOnHidden
      afterOpenChange={handleOpenChange}
    >
      <div
        style={{
          border: "1px solid var(--code-border)",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <MonacoEditor
          height="400px"
          language="plaintext"
          theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
          value={text}
          onChange={handleChange}
          options={{
            minimap: { enabled: false },
            lineNumbers: "on",
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
      <Form form={form} layout="vertical">
        <AuditReasonFormItem />
      </Form>
    </Modal>
  );
}
