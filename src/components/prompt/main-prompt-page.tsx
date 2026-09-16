"use client";

import { EditOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Menu,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useState } from "react";

import { observePromise } from "@/lib/async";
import { PromptFieldEditorModal } from "@/components/prompt/prompt-field-editor-modal";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  usePromptDetail,
  usePromptResources,
  useUpdatePromptField,
} from "@/lib/hooks/use-prompts";
import type { components } from "@/types/komari-api";

type PromptResourceSummary = components["schemas"]["PromptResourceSummary"];

type PromptFieldRow = {
  fieldName: string;
  value: string;
};

type EditingFieldState = {
  fieldName: string;
  value: string;
};

const EMPTY_RESOURCES: PromptResourceSummary[] = [];

export function MainPromptPage() {
  const { message } = App.useApp();
  const resourcesQuery = usePromptResources();
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
  const detailQuery = usePromptDetail(activeResourceId);
  const updateFieldMutation = useUpdatePromptField();
  const [editingField, setEditingField] = useState<EditingFieldState | null>(null);

  const selectedResource = detailQuery.data;
  const fieldRows = useMemo<PromptFieldRow[]>(() => {
    if (!selectedResource) {
      return [];
    }

    return selectedResource.fields.map((fieldName) => ({
      fieldName,
      value: selectedResource.values[fieldName] ?? "",
    }));
  }, [selectedResource]);

  const handleOpenEditor = useCallback((fieldName: string, value: string) => {
    setEditingField({ fieldName, value });
  }, []);

  const handleSubmitField = useCallback(
    async (value: string, auditReason: string) => {
      if (!editingField || !activeResourceId) {
        return;
      }

      try {
        await updateFieldMutation.mutateAsync({
          resourceId: activeResourceId,
          fieldName: editingField.fieldName,
          auditReason,
          data: { value },
        });
        observePromise(message.success(`字段 ${editingField.fieldName} 更新成功`));
        setEditingField(null);
      } catch (error) {
        observePromise(message.error(getRequestErrorMessage(error, `字段 ${editingField.fieldName} 更新失败`)));
      }
    },
    [activeResourceId, editingField, message, updateFieldMutation],
  );

  const columns = useMemo<ColumnsType<PromptFieldRow>>(
    () => [
      {
        title: "字段名",
        dataIndex: "fieldName",
        key: "fieldName",
        width: 240,
        render: (fieldName: string) => (
          <Typography.Text
            code
            style={{ display: "inline-block", maxWidth: "100%" }}
            ellipsis={{ tooltip: fieldName }}
          >
            {fieldName}
          </Typography.Text>
        ),
      },
      {
        title: "当前值",
        dataIndex: "value",
        key: "value",
        render: (value: string) => (
          <Tooltip
            title={
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 480 }}>{value}</pre>
            }
          >
            <Typography.Text
              style={{ display: "inline-block", maxWidth: "100%" }}
              ellipsis={{ tooltip: false }}
            >
              {value}
            </Typography.Text>
          </Tooltip>
        ),
      },
      {
        title: "操作",
        key: "actions",
        width: 110,
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
    <Space orientation="vertical" size={16} style={{ display: "flex" }} className="config-page">
      <div className="page-header">
        <div className="page-header__main">
          <Typography.Title level={2} className="page-title">
            主提示词
          </Typography.Title>
          <p className="page-description">
            查看并编辑小鞠的主提示词资源，修改后即时生效
          </p>
        </div>
      </div>

      {resourcesQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          title="提示词资源加载失败"
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
          title={isResourceCollapsed ? "资源" : "提示词资源"}
          extra={
            <Button
              type="text"
              size="small"
              icon={isResourceCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setIsResourceCollapsed((value) => !value)}
              aria-label={isResourceCollapsed ? "展开提示词资源栏" : "收起提示词资源栏"}
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
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12 }}
                      ellipsis={{ tooltip: resource.storage_key }}
                    >
                      {resource.storage_key}
                    </Typography.Text>
                  </div>
                ),
              }))}
              onClick={({ key }) => {
                setSelectedResourceId(String(key));
                setEditingField(null);
              }}
              style={{ borderInlineEnd: "none", background: "transparent" }}
            />
          ) : null}
          {!isResourceCollapsed && !resources.length ? (
            <Empty description="暂无提示词资源" />
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
              <Empty description="请选择一个提示词资源" />
            </Card>
          ) : null}

          {detailQuery.isError ? (
            <Alert
              showIcon
              type="error"
              title="提示词详情加载失败"
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
              >
                <Space orientation="vertical" size={8} style={{ display: "flex" }}>
                  <div>
                    <Typography.Text strong>资源 ID：</Typography.Text>
                    <Typography.Text code>{selectedResource.resource_id}</Typography.Text>
                  </div>
                  <div>
                    <Typography.Text strong>存储键：</Typography.Text>
                    <Typography.Text code>{selectedResource.storage_key}</Typography.Text>
                  </div>
                  <Space wrap size={[8, 8]}>
                    <Tag color="blue">修订版本 {selectedResource.revision}</Tag>
                    <Tag color="gold">字段数 {selectedResource.fields.length}</Tag>
                  </Space>
                </Space>
              </Card>

              <Card
                className="glass-card"
                variant="borderless"
                title={`字段列表 (${fieldRows.length})`}
              >
                <Table<PromptFieldRow>
                  rowKey="fieldName"
                  columns={columns}
                  dataSource={fieldRows}
                  pagination={false}
                  tableLayout="fixed"
                  locale={{ emptyText: "暂无字段数据" }}
                />
              </Card>
            </>
          ) : null}
        </Space>
      </div>

      {editingField ? (
        <PromptFieldEditorModal
          open
          title={`编辑字段 - ${editingField.fieldName}`}
          value={editingField.value}
          onCancel={() => setEditingField(null)}
          onOk={handleSubmitField}
          confirmLoading={updateFieldMutation.isPending}
        />
      ) : null}
    </Space>
  );
}
