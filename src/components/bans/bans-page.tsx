"use client";

import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  App,
  AutoComplete,
  Button,
  Card,
  Form,
  Grid,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";

import type { components } from "@/types/komari-api";
import { getRequestErrorMessage } from "@/lib/http/error";
import { formatDateTime } from "@/lib/format";
import { AuditReasonFormItem } from "@/components/audit-reason-form-item";
import {
  useBanList,
  useCreateOrUpdateBan,
  useDeleteBan,
} from "@/lib/hooks/use-bans";

type UserBanStatusResponse = components["schemas"]["UserBanStatusResponse"];
type BanRecordResponse = components["schemas"]["BanRecordResponse"];
type CreateBanRequest = components["schemas"]["CreateBanRequest"];

type BanScope = "chat" | "command";

const scopeOptions = [
  { value: "all", label: "全部" },
  { value: "chat", label: "聊天" },
  { value: "command", label: "命令" },
];

const scopeLabelMap: Record<string, string> = {
  chat: "聊天",
  command: "命令",
  all: "全部",
};

const durationPresets = [
  { value: "permanent", label: "永久" },
  { value: "1d", label: "1 天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];

const actionLabelMap: Record<string, string> = {
  created: "封禁已创建",
  updated: "封禁已更新",
  unchanged: "封禁状态未变化",
  removed: "封禁已解除",
};

interface BanFormValues {
  user_id: string;
  scope: CreateBanRequest["scope"];
  duration: string;
  reason?: string;
  auditReason: string;
}

export function BansPage() {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [scope, setScope] = useState<"chat" | "command" | "all" | undefined>(
    undefined,
  );

  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [unbanTarget, setUnbanTarget] = useState<{
    userId: string;
    scope: BanScope;
  } | null>(null);
  const [unbanReason, setUnbanReason] = useState("");

  const listParams = { scope, page, page_size: pageSize };
  const listQuery = useBanList(listParams);
  const createOrUpdateMutation = useCreateOrUpdateBan();
  const deleteMutation = useDeleteBan();

  const handleCreateSubmit = useCallback(
    async (values: BanFormValues) => {
      try {
        const result = await createOrUpdateMutation.mutateAsync({
          data: {
            user_id: values.user_id,
            scope: values.scope,
            duration: values.duration,
            reason: values.reason || null,
          },
          auditReason: values.auditReason,
        });
        message.success(actionLabelMap[result.action] ?? "操作成功");
        setCreateModalOpen(false);
      } catch (error) {
        message.error(getRequestErrorMessage(error, "封禁操作失败"));
      }
    },
    [createOrUpdateMutation, message],
  );

  const handleUnban = useCallback(async () => {
    if (!unbanTarget) {
      return;
    }
    try {
      await deleteMutation.mutateAsync({
        userId: unbanTarget.userId,
        scope: unbanTarget.scope,
        auditReason: unbanReason,
      });
      message.success("封禁已解除");
      setUnbanTarget(null);
      setUnbanReason("");
    } catch (error) {
      message.error(getRequestErrorMessage(error, "解除封禁失败"));
    }
  }, [deleteMutation, message, unbanReason, unbanTarget]);

  const columns = [
    {
      title: "用户 ID",
      dataIndex: "user_id",
      width: 140,
    },
    {
      title: "生效范围",
      dataIndex: "active_scopes",
      width: 160,
      render: (scopes: string[]) =>
        scopes.length ? (
          <Space size={[4, 4]} wrap>
            {scopes.map((s) => (
              <Tag key={s} color="red">
                {scopeLabelMap[s] ?? s}
              </Tag>
            ))}
          </Space>
        ) : (
          <Tag>无生效封禁</Tag>
        ),
    },
    {
      title: "记录数",
      width: 80,
      render: (_: unknown, record: UserBanStatusResponse) =>
        record.records.length,
    },
    {
      title: "超管豁免",
      dataIndex: "superuser_bypass",
      width: 100,
      render: (v: boolean) =>
        v ? <Tag color="gold">豁免</Tag> : <Tag>否</Tag>,
    },
  ];

  const expandedRowRender = (record: UserBanStatusResponse) => (
    <Table<BanRecordResponse>
      rowKey={(r) => `${r.user_id}:${r.scope}`}
      size="small"
      pagination={false}
      dataSource={record.records}
      columns={[
        {
          title: "范围",
          dataIndex: "scope",
          width: 90,
          render: (s: string) => (
            <Tag color="red">{scopeLabelMap[s] ?? s}</Tag>
          ),
        },
        {
          title: "原因",
          dataIndex: "reason",
          ellipsis: true,
          render: (v: string | null) => v ?? "-",
        },
        {
          title: "操作人",
          dataIndex: "operator_id",
          width: 120,
        },
        {
          title: "过期时间",
          dataIndex: "expires_at",
          width: 170,
          render: (v: string | null, r: BanRecordResponse) =>
            r.permanent ? <Tag color="volcano">永久</Tag> : formatDateTime(v, "-"),
        },
        {
          title: "创建时间",
          dataIndex: "created_at",
          width: 170,
          render: (v: string) => formatDateTime(v, "-"),
        },
        {
          title: "操作",
          width: 90,
          render: (_: unknown, r: BanRecordResponse) => (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                setUnbanReason("");
                setUnbanTarget({ userId: r.user_id, scope: r.scope });
              }}
            >
              解除
            </Button>
          ),
        },
      ]}
    />
  );

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <div className="page-header">
        <div className="page-header__main">
          <Typography.Title level={2} className="page-title">
            用户封禁
          </Typography.Title>
          <p className="page-description">
            管理用户在聊天与命令场景下的封禁状态
          </p>
        </div>
        <div className="page-header__actions">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            新增封禁
          </Button>
        </div>
      </div>

      <Card className="glass-card" variant="borderless">
        <Space wrap>
          <Select
            placeholder="范围筛选"
            allowClear
            value={scope}
            onChange={(v) => {
              setPage(1);
              setScope(v);
            }}
            options={scopeOptions}
            style={{ width: isMobile ? "100%" : 140 }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => listQuery.refetch()}
            loading={listQuery.isRefetching}
          >
            刷新
          </Button>
        </Space>
      </Card>

      <Card className="glass-card" variant="borderless">
        <Table<UserBanStatusResponse>
          rowKey="user_id"
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          expandable={{ expandedRowRender }}
          scroll={{ x: 720 }}
          size={isMobile ? "small" : "middle"}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total ?? 0,
            showSizeChanger: true,
            simple: isMobile,
            size: isMobile ? "small" : undefined,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      <BanCreateModal
        open={createModalOpen}
        confirmLoading={createOrUpdateMutation.isPending}
        onCancel={() => setCreateModalOpen(false)}
        onSubmit={handleCreateSubmit}
      />

      <Modal
        open={unbanTarget !== null}
        title={`解除封禁：${unbanTarget?.userId ?? ""}（${scopeLabelMap[unbanTarget?.scope ?? ""] ?? unbanTarget?.scope ?? ""}）`}
        onCancel={() => {
          setUnbanTarget(null);
          setUnbanReason("");
        }}
        onOk={handleUnban}
        okText="确认解除"
        okButtonProps={{
          danger: true,
          disabled: !unbanReason.trim(),
          loading: deleteMutation.isPending,
        }}
      >
        <Space orientation="vertical" size={8} style={{ display: "flex" }}>
          <Typography.Text>
            请输入变更理由（将记录到审计日志）：
          </Typography.Text>
          <Input.TextArea
            rows={3}
            value={unbanReason}
            onChange={(e) => setUnbanReason(e.target.value)}
            placeholder="例如：误封解除 / 申诉通过"
          />
        </Space>
      </Modal>
    </Space>
  );
}

interface BanCreateModalProps {
  open: boolean;
  confirmLoading: boolean;
  onCancel: () => void;
  onSubmit: (values: BanFormValues) => Promise<void>;
}

function BanCreateModal({
  open,
  confirmLoading,
  onCancel,
  onSubmit,
}: BanCreateModalProps) {
  const [form] = Form.useForm<BanFormValues>();

  useEffect(() => {
    if (!open) {
      return;
    }
    form.resetFields();
    form.setFieldsValue({ scope: "chat", duration: "permanent" });
  }, [open, form]);

  const handleOk = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) {
      return;
    }
    await onSubmit(values);
  }, [form, onSubmit]);

  return (
    <Modal
      open={open}
      title="新增 / 更新封禁"
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      width={560}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="user_id"
          label="用户 ID"
          rules={[
            { required: true, message: "请输入用户 ID" },
            {
              pattern: /^[1-9]\d*$/,
              message: "请输入不带前导零的 QQ 号",
            },
          ]}
        >
          <Input placeholder="不带前导零的 QQ 号" />
        </Form.Item>
        <Form.Item
          name="scope"
          label="封禁范围"
          rules={[{ required: true, message: "请选择封禁范围" }]}
        >
          <Select options={scopeOptions} />
        </Form.Item>
        <Form.Item
          name="duration"
          label="封禁时长"
          rules={[{ required: true, message: "请选择或输入封禁时长" }]}
          extra="可选预设，或直接输入自定义时长（如 7d、24h），合法性以后端校验为准"
        >
          <AutoComplete
            options={durationPresets}
            placeholder="选择预设或输入自定义时长（如 7d、24h）"
          />
        </Form.Item>
        <Form.Item name="reason" label="封禁原因（展示给用户）">
          <Input.TextArea rows={2} />
        </Form.Item>
        <AuditReasonFormItem />
      </Form>
    </Modal>
  );
}
