"use client";

import { Modal } from "antd";
import { useCallback, useState } from "react";
import Editor from "@monaco-editor/react";

interface JsonEditorModalProps {
  open: boolean;
  title: string;
  value: Record<string, unknown>;
  onCancel: () => void;
  onOk: (value: Record<string, unknown>) => void;
  confirmLoading?: boolean;
}

export function JsonEditorModal({
  open,
  title,
  value,
  onCancel,
  onOk,
  confirmLoading,
}: JsonEditorModalProps) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((val: string | undefined) => {
    const v = val ?? "";
    setText(v);
    try {
      JSON.parse(v);
      setError(null);
    } catch (e) {
      setError((e as SyntaxError).message);
    }
  }, []);

  const handleOk = useCallback(() => {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setError("JSON 必须是一个对象");
        return;
      }
      onOk(parsed);
    } catch {
      return;
    }
  }, [text, onOk]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onCancel();
      } else {
        setText(JSON.stringify(value, null, 2));
        setError(null);
      }
    },
    [onCancel, value],
  );

  return (
    <Modal
      open={open}
      title={title}
      onCancel={() => handleOpenChange(false)}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: !!error }}
      width={720}
      destroyOnHidden
      afterOpenChange={handleOpenChange}
    >
      <div style={{ border: "1px solid #d9d9d9", borderRadius: 8, overflow: "hidden" }}>
        <Editor
          height="400px"
          language="json"
          theme="vs"
          value={text}
          onChange={handleChange}
          options={{
            minimap: { enabled: false },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
      {error && (
        <div style={{ color: "#ff4d4f", marginTop: 8, fontSize: 12 }}>{error}</div>
      )}
    </Modal>
  );
}
