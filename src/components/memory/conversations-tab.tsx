"use client";

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";

import type { components } from "@/types/komari-api";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useConversationList,
  useCreateConversation,
  useDeleteConversation,
  useUpdateConversation,
} from "@/lib/hooks/use-conversations";

type ConversationEntry = components["schemas"]["ConversationEntry"];
type ConversationCreateRequest = components["schemas"]["ConversationCreateRequest"];
type ConversationUpdateRequest = components["schemas"]["ConversationUpdateRequest"];

type ConversationFormValues = {
  group_id: string;
  summary: string;
  participants?: string[];
  importance_initial: number;
  importance_current?: number;
  start_time?: string;
  end_time?: string;
};

export function ConversationsTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    group_id?: string;
    participant?: string;
    q?: string;
  }>({});

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalReady, setEditModalReady] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ConversationEntry | null>(null);

  const listParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useConversationList(listParams);
  const createMutation = useCreateConversation();
  const updateMutation = useUpdateConversation();
  const deleteMutation = useDeleteConversation();

  const handleCreate = useCallback(() => {
    setEditModalReady(true);
    setEditingRecord(null);
    setEditModalOpen(true);
  }, []);

  const handleEdit = useCallback(
    (record: ConversationEntry) => {
      setEditModalReady(true);
      setEditingRecord(record);
      setEditModalOpen(true);
    },
    [],
  );

  const handleSubmit = useCallback(async (values: ConversationFormValues) => {
    try {
      if (editingRecord) {
        const updateValues: ConversationUpdateRequest = values;
        await updateMutation.mutateAsync({
          conversationId: editingRecord.id,
          data: updateValues,
        });
        message.success("对话更新成功");
      } else {
        const createValues: ConversationCreateRequest = {
          group_id: values.group_id,
          summary: values.summary,
          participants: values.participants,
          importance_initial: values.importance_initial,
        };
        await createMutation.mutateAsync(createValues);
        message.success("对话创建成功");
      }
      setEditModalOpen(false);
      setEditingRecord(null);
    } catch (error) {
      message.error(
        getRequestErrorMessage(
          error,
          editingRecord ? "对话更新失败" : "对话创建失败",
        ),
      );
    }
  }, [editingRecord, createMutation, updateMutation]);

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteMutation.mutateAsync(id);
        message.success("对话删除成功");
      } catch (error) {
        message.error(getRequestErrorMessage(error, "对话删除失败"));
      }
    },
    [deleteMutation],
  );

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "Group ID", dataIndex: "group_id", width: 140, ellipsis: true },
    {
      title: "摘要",
      dataIndex: "summary",
      ellipsis: true,
    },
    {
      title: "参与者",
      dataIndex: "participants",
      width: 200,
      render: (v?: string[]) => (
        <Space wrap size={[4, 4]}>
          {(v ?? []).map((p) => (
            <Tag key={p}>{p}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "重要性",
      dataIndex: "importance_current",
      width: 90,
      render: (v: number) => <Tag color={v >= 4 ? "red" : v >= 2 ? "blue" : "default"}>{v}</Tag>,
    },
    {
      title: "时间范围",
      width: 200,
      render: (_: unknown, r: ConversationEntry) => {
        const start = new Date(r.start_time).toLocaleString("zh-CN");
        const end = new Date(r.end_time).toLocaleString("zh-CN");
        return `${start} ~ ${end}`;
      },
    },
    {
      title: "操作",
      width: 120,
      render: (_: unknown, record: ConversationEntry) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确认删除该对话？"
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
        <Space wrap style={{ display: "flex", justifyContent: "space-between" }}>
          <Space wrap>
            <Input
              placeholder="Group ID"
              allowClear
              value={filters.group_id}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, group_id: e.target.value || undefined }));
              }}
              style={{ width: 160 }}
            />
            <Input
              placeholder="参与者"
              allowClear
              prefix={<SearchOutlined />}
              value={filters.participant}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, participant: e.target.value || undefined }));
              }}
              style={{ width: 160 }}
            />
            <Input
              placeholder="搜索"
              allowClear
              prefix={<SearchOutlined />}
              value={filters.q}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, q: e.target.value || undefined }));
              }}
              style={{ width: 160 }}
            />
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增对话
          </Button>
        </Space>
      </Card>

      <Card className="glass-card" variant="borderless">
        <Table<ConversationEntry>
          rowKey="id"
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      {editModalReady ? (
        <ConversationEditModal
          open={editModalOpen}
          record={editingRecord}
          confirmLoading={createMutation.isPending || updateMutation.isPending}
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

interface ConversationEditModalProps {
  open: boolean;
  record: ConversationEntry | null;
  confirmLoading: boolean;
  onCancel: () => void;
  onSubmit: (values: ConversationFormValues) => Promise<void>;
}

function ConversationEditModal({
  open,
  record,
  confirmLoading,
  onCancel,
  onSubmit,
}: ConversationEditModalProps) {
  const [form] = Form.useForm<ConversationFormValues>();

  useEffect(() => {
    if (!open) {
      return;
    }

    if (record) {
      form.setFieldsValue({
        group_id: record.group_id,
        summary: record.summary,
        participants: record.participants ?? [],
        importance_initial: record.importance_initial,
        importance_current: record.importance_current,
        start_time: record.start_time,
        end_time: record.end_time,
      });
      return;
    }

    form.resetFields();
    form.setFieldsValue({ importance_initial: 3 });
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
      title={record ? "编辑对话" : "新增对话"}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      width={600}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="group_id"
          label="Group ID"
          rules={[{ required: true, message: "请输入 Group ID" }]}
        >
          <Input disabled={!!record} />
        </Form.Item>
        <Form.Item
          name="summary"
          label="摘要"
          rules={[{ required: true, message: "请输入摘要" }]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="participants" label="参与者">
          <Select
            mode="tags"
            placeholder="输入参与者后回车"
            tokenSeparators={[",", "，"]}
          />
        </Form.Item>
        <Form.Item
          name="importance_initial"
          label="初始重要性"
          rules={[{ required: true }]}
        >
          <InputNumber min={1} max={5} />
        </Form.Item>
        {record && (
          <>
            <Form.Item name="importance_current" label="当前重要性">
              <InputNumber min={1} max={5} />
            </Form.Item>
            <Form.Item name="start_time" label="开始时间">
              <Input placeholder="ISO 8601 日期时间" />
            </Form.Item>
            <Form.Item name="end_time" label="结束时间">
              <Input placeholder="ISO 8601 日期时间" />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}
