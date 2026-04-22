"use client";

import {
  EditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Menu,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useState } from "react";

import { JsonEditorModal } from "@/components/json-editor-modal";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useConfigDetail,
  useConfigResources,
  useReloadConfig,
  useUpdateConfigField,
} from "@/lib/hooks/use-config";
import type { components } from "@/types/komari-api";

type ConfigResourceSummary = components["schemas"]["ConfigResourceSummary"];
type ConfigFieldRow = {
  fieldName: string;
  description?: string;
  value: unknown;
};

type PrimitiveFieldState = {
  fieldName: string;
  mode: "string" | "number" | "boolean" | "null";
  value: unknown;
};

type JsonFieldState = {
  fieldName: string;
  value: Record<string, unknown>;
};

const EMPTY_RESOURCES: ConfigResourceSummary[] = [];

export function ConfigPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const resourcesQuery = useConfigResources();
  const resources = resourcesQuery.data?.items ?? EMPTY_RESOURCES;
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [isResourceCollapsed, setIsResourceCollapsed] = useState(false);
  const activeResourceId = useMemo(() => {
    if (!resources.length) {
      return null;
    }

    if (selectedResourceId && resources.some((item) => item.resource_id === selectedResourceId)) {
      return selectedResourceId;
    }

    return resources[0]?.resource_id ?? null;
  }, [resources, selectedResourceId]);
  const detailQuery = useConfigDetail(activeResourceId);
  const updateFieldMutation = useUpdateConfigField();
  const reloadConfigMutation = useReloadConfig();
  const [primitiveField, setPrimitiveField] = useState<PrimitiveFieldState | null>(null);
  const [jsonField, setJsonField] = useState<JsonFieldState | null>(null);

  const selectedResource = detailQuery.data;
  const fieldRows = useMemo<ConfigFieldRow[]>(() => {
    if (!selectedResource) {
      return [];
    }

    return selectedResource.fields.map((fieldName) => ({
      fieldName,
      description: selectedResource.field_descriptions?.[fieldName],
      value: selectedResource.values[fieldName],
    }));
  }, [selectedResource]);

  const handleOpenEditor = useCallback((fieldName: string, value: unknown) => {
    if (Array.isArray(value)) {
      setJsonField({ fieldName, value: { items: value } });
      return;
    }

    if (isRecord(value)) {
      setJsonField({ fieldName, value });
      return;
    }

    const mode = getPrimitiveMode(value);
    setPrimitiveField({
      fieldName,
      mode,
      value,
    });
  }, []);

  const handleSubmitPrimitive = useCallback(async () => {
    if (!primitiveField || !activeResourceId) {
      return;
    }

    try {
      form.setFieldsValue({ value: getPrimitiveFormValue(primitiveField) });
      const values = await form.validateFields();
      await updateFieldMutation.mutateAsync({
        resourceId: activeResourceId,
        fieldName: primitiveField.fieldName,
        data: {
          value: normalizePrimitiveValue(primitiveField.mode, values.value),
        },
      });
      message.success(`字段 ${primitiveField.fieldName} 更新成功`);
      setPrimitiveField(null);
    } catch (error) {
      if (isValidationError(error)) {
        return;
      }

      message.error(getRequestErrorMessage(error, `字段 ${primitiveField.fieldName} 更新失败`));
    }
  }, [activeResourceId, form, message, primitiveField, updateFieldMutation]);

  const handleSubmitJson = useCallback(
    async (value: Record<string, unknown>) => {
      if (!jsonField || !activeResourceId) {
        return;
      }

      const payloadValue = Array.isArray(selectedResource?.values[jsonField.fieldName])
        ? (value.items ?? [])
        : value;

      try {
        await updateFieldMutation.mutateAsync({
          resourceId: activeResourceId,
          fieldName: jsonField.fieldName,
          data: { value: payloadValue },
        });
        message.success(`字段 ${jsonField.fieldName} 更新成功`);
        setJsonField(null);
      } catch (error) {
        message.error(getRequestErrorMessage(error, `字段 ${jsonField.fieldName} 更新失败`));
      }
    },
    [activeResourceId, jsonField, message, selectedResource, updateFieldMutation],
  );

  const handleReload = useCallback(async () => {
    if (!activeResourceId || !selectedResource) {
      return;
    }

    try {
      await reloadConfigMutation.mutateAsync(activeResourceId);
      message.success(`${selectedResource.display_name} 重载成功`);
    } catch (error) {
      message.error(getRequestErrorMessage(error, `${selectedResource.display_name} 重载失败`));
    }
  }, [activeResourceId, message, reloadConfigMutation, selectedResource]);

  const columns = useMemo<ColumnsType<ConfigFieldRow>>(
    () => [
      {
        title: "字段名",
        dataIndex: "fieldName",
        key: "fieldName",
        width: 220,
        render: (fieldName: string) => <Typography.Text code>{fieldName}</Typography.Text>,
      },
      {
        title: "当前值",
        dataIndex: "value",
        key: "value",
        width: 420,
        render: (value: unknown) => renderConfigValue(value),
      },
      {
        title: "说明",
        dataIndex: "description",
        key: "description",
        width: 320,
        render: (description?: string) =>
          description ? (
            <Typography.Paragraph
              style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
              ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
            >
              {description}
            </Typography.Paragraph>
          ) : (
            <Typography.Text className="subtle-text">暂无说明</Typography.Text>
          ),
      },
      {
        title: "操作",
        key: "actions",
        width: 120,
        render: (_, row) => (
          <Button icon={<EditOutlined />} onClick={() => handleOpenEditor(row.fieldName, row.value)}>
            编辑
          </Button>
        ),
      },
    ],
    [handleOpenEditor],
  );

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      {resourcesQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          message="配置资源加载失败"
          description={
            resourcesQuery.error instanceof Error
              ? resourcesQuery.error.message
              : "请稍后重试。"
          }
        />
      ) : null}

      <div
        className={`config-page__layout${isResourceCollapsed ? " config-page__layout--collapsed" : ""}`}
      >
        <Card
          className={`glass-card config-page__resource-card${isResourceCollapsed ? " config-page__resource-card--collapsed" : ""}`}
          variant="borderless"
          title={isResourceCollapsed ? "资源" : "配置资源"}
          extra={
            <Button
              type="text"
              size="small"
              icon={isResourceCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setIsResourceCollapsed((value) => !value)}
              aria-label={isResourceCollapsed ? "展开配置资源栏" : "收起配置资源栏"}
            >
              {isResourceCollapsed ? "展开" : "收起"}
            </Button>
          }
          loading={resourcesQuery.isPending}
          styles={{ body: { padding: 12 } }}
        >
          {!isResourceCollapsed && resources.length ? (
            <Menu
              mode="inline"
              selectedKeys={activeResourceId ? [activeResourceId] : []}
              items={resources.map((resource) => ({
                key: resource.resource_id,
                label: (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      minHeight: 44,
                      lineHeight: 1.4,
                    }}
                  >
                    <Typography.Text strong>{resource.display_name}</Typography.Text>
                    {resource.description ? (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                        ellipsis={{ tooltip: resource.description }}
                      >
                        {resource.description}
                      </Typography.Text>
                    ) : null}
                  </div>
                ),
              }))}
              onClick={({ key }) => {
                setSelectedResourceId(String(key));
                setPrimitiveField(null);
                setJsonField(null);
              }}
              style={{ borderInlineEnd: "none", background: "transparent" }}
            />
          ) : null}
          {!isResourceCollapsed && !resources.length ? (
            <Empty description="暂无配置资源" />
          ) : null}
        </Card>

        <Space
          className="config-page__detail"
          orientation="vertical"
          size={16}
          style={{ display: "flex", minWidth: 0 }}
        >
          {!activeResourceId && !resourcesQuery.isPending ? (
            <Card className="glass-card" variant="borderless">
              <Empty description="请选择一个配置资源" />
            </Card>
          ) : null}

          {detailQuery.isError ? (
            <Alert
              showIcon
              type="error"
              message="配置详情加载失败"
              description={
                detailQuery.error instanceof Error ? detailQuery.error.message : "请稍后重试。"
              }
            />
          ) : null}

          {activeResourceId && detailQuery.isPending && !selectedResource ? (
            <Card className="glass-card" variant="borderless" loading />
          ) : null}

          {selectedResource ? (
            <>
              <Card
                className="glass-card config-page__summary-card"
                variant="borderless"
                title={selectedResource.display_name}
                extra={
                  <Popconfirm
                    title="确认重载这个配置资源？"
                    description="重载会立即影响运行中的配置。"
                    okText="确认重载"
                    cancelText="取消"
                    onConfirm={handleReload}
                  >
                    <Button
                      icon={<ReloadOutlined />}
                      loading={reloadConfigMutation.isPending}
                    >
                      重载配置
                    </Button>
                  </Popconfirm>
                }
              >
                <Space orientation="vertical" size={8} style={{ display: "flex" }}>
                  <div>
                    <Typography.Text strong>资源 ID：</Typography.Text>
                    <Typography.Text code>{selectedResource.resource_id}</Typography.Text>
                  </div>
                  <div>
                    <Typography.Text strong>配置文件：</Typography.Text>
                    <Typography.Text>{selectedResource.config_file}</Typography.Text>
                  </div>
                  {selectedResource.description ? (
                    <div>
                      <Typography.Text strong>配置说明：</Typography.Text>
                      <Typography.Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
                        {selectedResource.description}
                      </Typography.Paragraph>
                    </div>
                  ) : null}
                  <Space wrap size={[8, 8]}>
                    <Tag color="geekblue">字段数 {selectedResource.fields.length}</Tag>
                  </Space>
                </Space>
              </Card>

              <Card
                className="glass-card"
                variant="borderless"
                title={`字段列表 (${fieldRows.length})`}
              >
                <Table<ConfigFieldRow>
                  rowKey="fieldName"
                  columns={columns}
                  dataSource={fieldRows}
                  pagination={false}
                  scroll={{ x: 1080 }}
                  locale={{ emptyText: "暂无字段数据" }}
                />
              </Card>
            </>
          ) : null}
        </Space>
      </div>

      <Modal
        open={!!primitiveField}
        title={primitiveField ? `编辑字段 - ${primitiveField.fieldName}` : "编辑字段"}
        onCancel={() => setPrimitiveField(null)}
        onOk={handleSubmitPrimitive}
        confirmLoading={updateFieldMutation.isPending}
        destroyOnHidden
      >
        {primitiveField ? (
          <Form form={form} layout="vertical">
            <Form.Item label="字段名">
              <Input value={primitiveField.fieldName} disabled />
            </Form.Item>
            <Form.Item label="字段说明">
              <Input
                value={selectedResource?.field_descriptions?.[primitiveField.fieldName] ?? "暂无说明"}
                disabled
              />
            </Form.Item>
            {primitiveField.mode === "string" ? (
              <Form.Item
                name="value"
                label="字段值"
                rules={[{ required: true, message: "请输入字段值" }]}
              >
                <Input.TextArea rows={4} placeholder="请输入字符串值" />
              </Form.Item>
            ) : null}
            {primitiveField.mode === "number" ? (
              <Form.Item
                name="value"
                label="字段值"
                rules={[{ required: true, message: "请输入字段值" }]}
              >
                <InputNumber style={{ width: "100%" }} placeholder="请输入数字值" />
              </Form.Item>
            ) : null}
            {primitiveField.mode === "boolean" ? (
              <Form.Item name="value" label="字段值" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
            ) : null}
            {primitiveField.mode === "null" ? (
              <Alert
                type="info"
                showIcon
                message="当前字段值为 null"
                description="这里按字符串方式编辑，保存后将以文本形式写入配置。"
              />
            ) : null}
          </Form>
        ) : null}
      </Modal>

      {jsonField ? (
        <JsonEditorModal
          open
          title={`编辑字段 - ${jsonField.fieldName}`}
          value={jsonField.value}
          description={selectedResource?.field_descriptions?.[jsonField.fieldName]}
          onCancel={() => setJsonField(null)}
          onOk={handleSubmitJson}
          confirmLoading={updateFieldMutation.isPending}
        />
      ) : null}
    </Space>
  );
}

function renderConfigValue(value: unknown) {
  if (typeof value === "string") {
    return <Typography.Text>{value || ""}</Typography.Text>;
  }

  if (typeof value === "number") {
    return <Typography.Text>{value}</Typography.Text>;
  }

  if (typeof value === "boolean") {
    return <Tag color={value ? "green" : "default"}>{value ? "true" : "false"}</Tag>;
  }

  if (value === null) {
    return <Tag>null</Tag>;
  }

  if (value === undefined) {
    return <Typography.Text className="subtle-text">未配置</Typography.Text>;
  }

  const text = safeJsonStringify(value);

  return (
    <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{text}</pre>}>
      <Typography.Text
        style={{
          display: "inline-block",
          maxWidth: "100%",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        ellipsis={{ tooltip: false }}
      >
        {text}
      </Typography.Text>
    </Tooltip>
  );
}

function getPrimitiveMode(value: unknown): PrimitiveFieldState["mode"] {
  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (value === null || value === undefined) {
    return "null";
  }

  return "string";
}

function getPrimitiveFormValue(field: PrimitiveFieldState) {
  if (field.mode === "boolean") {
    return Boolean(field.value);
  }

  if (field.mode === "number") {
    return typeof field.value === "number" ? field.value : undefined;
  }

  return typeof field.value === "string" ? field.value : "";
}

function normalizePrimitiveValue(mode: PrimitiveFieldState["mode"], value: unknown) {
  if (mode === "boolean") {
    return Boolean(value);
  }

  if (mode === "number") {
    return typeof value === "number" ? value : Number(value);
  }

  return typeof value === "string" ? value : String(value ?? "");
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidationError(error: unknown) {
  return !!error && typeof error === "object" && "errorFields" in error;
}
