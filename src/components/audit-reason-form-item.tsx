"use client";

import { Form, Input } from "antd";

export function AuditReasonFormItem() {
  return (
    <Form.Item
      name="auditReason"
      label="变更理由（审计记录）"
      rules={[{ required: true, message: "请输入变更理由" }]}
    >
      <Input.TextArea rows={2} placeholder="将写入 X-Komari-Change-Reason" />
    </Form.Item>
  );
}
