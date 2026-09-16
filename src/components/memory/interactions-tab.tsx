"use client";

import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Grid,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";

import type { components } from "@/types/komari-api";
import { getRequestErrorMessage } from "@/lib/http/error";
import { formatDateTime } from "@/lib/format";
import {
  useDeleteInteractionEvent,
  useInteractionList,
  useUpdateInteractionEvent,
} from "@/lib/hooks/use-interactions";

type InteractionEventEntry = components["schemas"]["InteractionEventEntry"];
type InteractionEventUpdateRequest =
  components["schemas"]["InteractionEventUpdateRequest"];

function formatTime(value: string | null | undefined): string {
  return formatDateTime(value, "-");
}

export function InteractionsTab() {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [userIdInput, setUserIdInput] = useState("");
  const [qInput, setQInput] = useState("");
  const [filters, setFilters] = useState<{ user_id?: string; q?: string }>({});

  const [detailRecord, setDetailRecord] =
    useState<InteractionEventEntry | null>(null);

  const [editModalReady, setEditModalReady] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] =
    useState<InteractionEventEntry | null>(null);

  const listParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useInteractionList(listParams);
  const updateMutation = useUpdateInteractionEvent();
  const deleteMutation = useDeleteInteractionEvent();

  const handleSearch = useCallback(() => {
    setPage(1);
    setFilters({
      user_id: userIdInput.trim() || undefined,
      q: qInput.trim() || undefined,
    });
  }, [userIdInput, qInput]);

  const handleReset = useCallback(() => {
    setUserIdInput("");
    setQInput("");
    setPage(1);
    setFilters({});
  }, []);

  const handleEdit = useCallback((record: InteractionEventEntry) => {
    setEditModalReady(true);
    setEditingRecord(record);
    setEditModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (values: InteractionEventUpdateRequest) => {
      if (!editingRecord) {
        return;
      }
      try {
        await updateMutation.mutateAsync({
          eventId: editingRecord.id,
          data: values,
        });
        message.success("互动事件更新成功");
        setEditModalOpen(false);
        setEditingRecord(null);
      } catch (error) {
        message.error(getRequestErrorMessage(error, "互动事件更新失败"));
      }
    },
    [editingRecord, message, updateMutation],
  );

  const handleDelete = useCallback(
    async (eventId: number) => {
      try {
        await deleteMutation.mutateAsync(eventId);
        message.success("互动事件删除成功");
      } catch (error) {
        message.error(getRequestErrorMessage(error, "互动事件删除失败"));
      }
    },
    [deleteMutation, message],
  );

  const columns = [
    {
      title: "ID",
      dataIndex: "id",
      width: 70,
    },
    {
      title: "用户",
      dataIndex: "display_name",
      width: 180,
      render: (name: string, record: InteractionEventEntry) => (
        <Space orientation="vertical" size={0}>
          <span>{name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.user_id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "事件摘要",
      dataIndex: "event_summary",
      ellipsis: true,
      render: (v: string, record: InteractionEventEntry) => (
        <Space size={4}>
          {record.is_fuzzy ? <Tag color="gold">模糊</Tag> : null}
          <span>{v}</span>
        </Space>
      ),
    },
    {
      title: "重要度（当前/初始）",
      width: 150,
      render: (_: unknown, record: InteractionEventEntry) =>
        `${record.importance_current} / ${record.importance_initial}`,
    },
    {
      title: "最近出现",
      dataIndex: "last_seen_at",
      width: 170,
      render: (v: string) => formatTime(v),
    },
    {
      title: "操作",
      width: 130,
      render: (_: unknown, record: InteractionEventEntry) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetailRecord(record)}
          />
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确认删除该互动事件？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <Card className="glass-card" variant="borderless">
        <Space wrap>
          <Input
            placeholder="用户 ID（精确筛选）"
            allowClear
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: isMobile ? "100%" : 180 }}
          />
          <Input
            placeholder="关键词搜索"
            prefix={<SearchOutlined />}
            allowClear
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: isMobile ? "100%" : 200 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            查询
          </Button>
          <Button onClick={handleReset}>重置</Button>
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
        <Table<InteractionEventEntry>
          rowKey="id"
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 980 }}
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

      <Drawer
        open={detailRecord !== null}
        title={`互动事件 #${detailRecord?.id ?? ""}`}
        onClose={() => setDetailRecord(null)}
        size={520}
      >
        {detailRecord ? (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">{detailRecord.id}</Descriptions.Item>
            <Descriptions.Item label="用户 ID">
              {detailRecord.user_id}
            </Descriptions.Item>
            <Descriptions.Item label="显示名">
              {detailRecord.display_name}
            </Descriptions.Item>
            <Descriptions.Item label="事件摘要">
              {detailRecord.event_summary}
            </Descriptions.Item>
            <Descriptions.Item label="来源消息数">
              {detailRecord.source_message_count}
            </Descriptions.Item>
            <Descriptions.Item label="重要度">
              {detailRecord.importance}
            </Descriptions.Item>
            <Descriptions.Item label="初始重要度">
              {detailRecord.importance_initial}
            </Descriptions.Item>
            <Descriptions.Item label="当前重要度">
              {detailRecord.importance_current}
            </Descriptions.Item>
            <Descriptions.Item label="首次出现">
              {formatTime(detailRecord.first_seen_at)}
            </Descriptions.Item>
            <Descriptions.Item label="最近出现">
              {formatTime(detailRecord.last_seen_at)}
            </Descriptions.Item>
            <Descriptions.Item label="最近访问">
              {formatTime(detailRecord.last_accessed)}
            </Descriptions.Item>
            <Descriptions.Item label="模糊匹配">
              {detailRecord.is_fuzzy ? "是" : "否"}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {formatTime(detailRecord.created_at)}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>

      {editModalReady ? (
        <InteractionEditModal
          open={editModalOpen}
          record={editingRecord}
          confirmLoading={updateMutation.isPending}
          onCancel={() => {
            setEditModalOpen(false);
            setEditingRecord(null);
          }}
          onSubmit={handleSubmit}
        />
      ) : null}
    </Space>
  );
}

interface InteractionEditModalProps {
  open: boolean;
  record: InteractionEventEntry | null;
  confirmLoading: boolean;
  onCancel: () => void;
  onSubmit: (values: InteractionEventUpdateRequest) => Promise<void>;
}

function InteractionEditModal({
  open,
  record,
  confirmLoading,
  onCancel,
  onSubmit,
}: InteractionEditModalProps) {
  const [form] = Form.useForm<InteractionEventUpdateRequest>();

  useEffect(() => {
    if (!open || !record) {
      return;
    }
    form.setFieldsValue({
      event_summary: record.event_summary,
      importance_initial: record.importance_initial,
      importance_current: record.importance_current,
    });
  }, [open, record, form]);

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
      title={`编辑互动事件 #${record?.id ?? ""}`}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      width={560}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="event_summary" label="事件摘要">
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item name="importance_initial" label="初始重要度">
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="importance_current" label="当前重要度">
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
