"use client";

import {
  EditOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Grid,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";

import type { components } from "@/types/komari-api";
import { getRequestErrorMessage } from "@/lib/http/error";
import { AuditReasonFormItem } from "@/components/audit-reason-form-item";
import {
  usePatchScene,
  useSceneDetail,
  useSceneList,
  useSyncScenes,
} from "@/lib/hooks/use-scenes";

type SceneSummary = components["schemas"]["SceneSummary"];
type ScenePatchRequest = components["schemas"]["ScenePatchRequest"];
type SceneSyncResponse = components["schemas"]["SceneSyncResponse"];

const sceneTypeColorMap: Record<string, string> = {
  fixed: "geekblue",
  general: "green",
};

const sceneTypeLabelMap: Record<string, string> = {
  fixed: "固定",
  general: "通用",
};

interface SceneEditValues {
  content_text: string;
  enabled: boolean;
  order_index: number;
  auditReason: string;
}

function truncateHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

export function ScenesPage() {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncReason, setSyncReason] = useState("");

  const [toggleTarget, setToggleTarget] = useState<SceneSummary | null>(null);
  const [toggleReason, setToggleReason] = useState("");

  const [editingKey, setEditingKey] = useState<string | null>(null);

  const listQuery = useSceneList();
  const patchMutation = usePatchScene();
  const syncMutation = useSyncScenes();

  const sortedItems = [...(listQuery.data?.items ?? [])].sort(
    (a, b) => a.order_index - b.order_index,
  );

  const handleSync = useCallback(async () => {
    try {
      const result: SceneSyncResponse = await syncMutation.mutateAsync({
        auditReason: syncReason,
      });
      message.success(
        `同步${result.triggered ? "已触发" : "未触发"}：新增 ${result.inserted_count ?? 0}，就绪 ${result.ready_count ?? 0}，待处理 ${result.pending_count ?? 0}。${result.detail}`,
      );
      setSyncModalOpen(false);
      setSyncReason("");
    } catch (error) {
      message.error(getRequestErrorMessage(error, "场景同步失败"));
    }
  }, [message, syncMutation, syncReason]);

  const handleToggle = useCallback(async () => {
    if (!toggleTarget) {
      return;
    }
    try {
      await patchMutation.mutateAsync({
        sceneKey: toggleTarget.scene_key,
        data: { enabled: !toggleTarget.enabled },
        auditReason: toggleReason,
      });
      message.success(
        `场景「${toggleTarget.scene_key}」已${toggleTarget.enabled ? "禁用" : "启用"}`,
      );
      setToggleTarget(null);
      setToggleReason("");
    } catch (error) {
      message.error(getRequestErrorMessage(error, "场景状态切换失败"));
    }
  }, [message, patchMutation, toggleReason, toggleTarget]);

  const columns = [
    {
      title: "场景键",
      dataIndex: "scene_key",
      width: 200,
    },
    {
      title: "类型",
      dataIndex: "scene_type",
      width: 90,
      render: (t: string) => (
        <Tag color={sceneTypeColorMap[t] ?? "default"}>
          {sceneTypeLabelMap[t] ?? t}
        </Tag>
      ),
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (enabled: boolean, record: SceneSummary) => (
        <Switch
          checked={enabled}
          size="small"
          onChange={() => {
            setToggleReason("");
            setToggleTarget(record);
          }}
        />
      ),
    },
    {
      title: "排序",
      dataIndex: "order_index",
      width: 80,
    },
    {
      title: "内容哈希",
      dataIndex: "content_hash",
      width: 140,
      render: (v: string) => (
        <Typography.Text code title={v}>
          {truncateHash(v)}
        </Typography.Text>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      width: 80,
      render: (_: unknown, record: SceneSummary) => (
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => setEditingKey(record.scene_key)}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <div className="page-header">
        <div className="page-header__main">
          <Typography.Title level={2} className="page-title">
            决策场景
          </Typography.Title>
          <p className="page-description">
            管理小鞠决策时使用的场景提示词与启停状态
          </p>
        </div>
        <div className="page-header__actions">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => listQuery.refetch()}
            loading={listQuery.isRefetching}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={() => {
              setSyncReason("");
              setSyncModalOpen(true);
            }}
          >
            同步场景
          </Button>
        </div>
      </div>

      <Card className="glass-card" variant="borderless">
        <Table<SceneSummary>
          rowKey="scene_key"
          columns={columns}
          dataSource={sortedItems}
          loading={listQuery.isPending}
          scroll={{ x: 900 }}
          size={isMobile ? "small" : "middle"}
          pagination={false}
        />
      </Card>

      <Modal
        open={syncModalOpen}
        title="同步决策场景"
        onCancel={() => {
          setSyncModalOpen(false);
          setSyncReason("");
        }}
        onOk={handleSync}
        okText="确认同步"
        confirmLoading={syncMutation.isPending}
        okButtonProps={{ disabled: !syncReason.trim() }}
      >
        <Space orientation="vertical" size={8} style={{ display: "flex" }}>
          <Typography.Text>
            将从代码仓库同步场景定义到数据库。请输入变更理由（将记录到审计日志）：
          </Typography.Text>
          <Input.TextArea
            rows={3}
            value={syncReason}
            onChange={(e) => setSyncReason(e.target.value)}
            placeholder="例如：例行同步场景定义"
          />
        </Space>
      </Modal>

      <Modal
        open={toggleTarget !== null}
        title={`${toggleTarget?.enabled ? "禁用" : "启用"}场景：${toggleTarget?.scene_key ?? ""}`}
        onCancel={() => {
          setToggleTarget(null);
          setToggleReason("");
        }}
        onOk={handleToggle}
        okText="确认"
        confirmLoading={patchMutation.isPending}
        okButtonProps={{ disabled: !toggleReason.trim() }}
      >
        <Space orientation="vertical" size={8} style={{ display: "flex" }}>
          <Typography.Text>
            请输入变更理由（将记录到审计日志）：
          </Typography.Text>
          <Input.TextArea
            rows={3}
            value={toggleReason}
            onChange={(e) => setToggleReason(e.target.value)}
            placeholder="例如：临时关闭某场景以排查问题"
          />
        </Space>
      </Modal>

      <SceneEditDrawer
        sceneKey={editingKey}
        onClose={() => setEditingKey(null)}
      />
    </Space>
  );
}

interface SceneEditDrawerProps {
  sceneKey: string | null;
  onClose: () => void;
}

function SceneEditDrawer({ sceneKey, onClose }: SceneEditDrawerProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<SceneEditValues>();
  const detailQuery = useSceneDetail(sceneKey ?? undefined);
  const patchMutation = usePatchScene();

  useEffect(() => {
    if (!sceneKey || !detailQuery.data) {
      return;
    }
    form.setFieldsValue({
      content_text: detailQuery.data.content_text,
      enabled: detailQuery.data.enabled,
      order_index: detailQuery.data.order_index,
      auditReason: "",
    });
  }, [sceneKey, detailQuery.data, form]);

  const handleSubmit = useCallback(async () => {
    if (!sceneKey || !detailQuery.data) {
      return;
    }
    const values = await form.validateFields().catch(() => null);
    if (!values) {
      return;
    }

    const patch: ScenePatchRequest = {};
    if (values.content_text !== detailQuery.data.content_text) {
      patch.content_text = values.content_text;
    }
    if (values.enabled !== detailQuery.data.enabled) {
      patch.enabled = values.enabled;
    }
    if (values.order_index !== detailQuery.data.order_index) {
      patch.order_index = values.order_index;
    }

    if (Object.keys(patch).length === 0) {
      message.info("没有需要保存的变更");
      onClose();
      return;
    }

    try {
      await patchMutation.mutateAsync({
        sceneKey,
        data: patch,
        auditReason: values.auditReason,
      });
      message.success("场景已更新");
      onClose();
    } catch (error) {
      message.error(getRequestErrorMessage(error, "场景更新失败"));
    }
  }, [sceneKey, detailQuery.data, form, message, onClose, patchMutation]);

  return (
    <Drawer
      open={sceneKey !== null}
      title={`编辑场景：${sceneKey ?? ""}`}
      onClose={onClose}
      size={640}
      extra={
        <Button
          type="primary"
          onClick={handleSubmit}
          loading={patchMutation.isPending}
        >
          保存
        </Button>
      }
    >
      {detailQuery.isPending ? (
        <Spin />
      ) : (
        <Form form={form} layout="vertical">
          <Form.Item
            name="content_text"
            label="场景内容"
            rules={[{ required: true, message: "请输入场景内容" }]}
          >
            <Input.TextArea rows={12} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="order_index" label="排序权重">
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <AuditReasonFormItem />
        </Form>
      )}
    </Drawer>
  );
}
