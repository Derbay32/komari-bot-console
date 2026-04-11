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
  Drawer,
  Empty,
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
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";

import type { components } from "@/types/komari-api";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useCreateKnowledge,
  useDeleteKnowledge,
  useKnowledgeList,
  useSearchKnowledge,
  useUpdateKnowledge,
} from "@/lib/hooks/use-knowledge";

type KnowledgeEntry = components["schemas"]["KnowledgeEntry"];
type KnowledgeCreateRequest = components["schemas"]["KnowledgeCreateRequest"];
type KnowledgeCategory = "general" | "character" | "setting" | "plot" | "other";

const categoryOptions: { value: KnowledgeCategory; label: string }[] = [
  { value: "general", label: "通用" },
  { value: "character", label: "角色" },
  { value: "setting", label: "设定" },
  { value: "plot", label: "剧情" },
  { value: "other", label: "其他" },
];

const categoryColorMap: Record<KnowledgeCategory, string> = {
  general: "blue",
  character: "purple",
  setting: "green",
  plot: "orange",
  other: "default",
};

export function KnowledgePage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    q?: string;
    category?: KnowledgeCategory;
  }>({});

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalReady, setEditModalReady] = useState(false);
  const [editingRecord, setEditingRecord] = useState<KnowledgeEntry | null>(null);

  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(5);

  const listParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useKnowledgeList(listParams);
  const createMutation = useCreateKnowledge();
  const updateMutation = useUpdateKnowledge();
  const deleteMutation = useDeleteKnowledge();
  const searchMutation = useSearchKnowledge();

  const handleCreate = useCallback(() => {
    setEditModalReady(true);
    setEditingRecord(null);
    setEditModalOpen(true);
  }, []);

  const handleEdit = useCallback(
    (record: KnowledgeEntry) => {
      setEditModalReady(true);
      setEditingRecord(record);
      setEditModalOpen(true);
    },
    [],
  );

  const handleSubmit = useCallback(async (values: KnowledgeCreateRequest) => {
    try {
      if (editingRecord) {
        await updateMutation.mutateAsync({ kid: editingRecord.id, data: values });
        message.success("知识更新成功");
      } else {
        await createMutation.mutateAsync(values);
        message.success("知识创建成功");
      }
      setEditModalOpen(false);
      setEditingRecord(null);
    } catch (error) {
      message.error(
        getRequestErrorMessage(
          error,
          editingRecord ? "知识更新失败" : "知识创建失败",
        ),
      );
    }
  }, [editingRecord, createMutation, updateMutation]);

  const handleDelete = useCallback(
    async (kid: number) => {
      try {
        await deleteMutation.mutateAsync(kid);
        message.success("知识删除成功");
      } catch (error) {
        message.error(getRequestErrorMessage(error, "知识删除失败"));
      }
    },
    [deleteMutation],
  );

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      message.warning("请输入搜索内容");
      return;
    }

    try {
      await searchMutation.mutateAsync({ query: searchQuery, limit: searchLimit });
    } catch (error) {
      message.error(getRequestErrorMessage(error, "知识搜索失败"));
    }
  }, [searchQuery, searchLimit, searchMutation]);

  const columns = [
    {
      title: "ID",
      dataIndex: "id",
      width: 70,
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 100,
      render: (cat: KnowledgeCategory) => (
        <Tag color={categoryColorMap[cat]}>{categoryOptions.find((o) => o.value === cat)?.label ?? cat}</Tag>
      ),
    },
    {
      title: "关键词",
      dataIndex: "keywords",
      width: 200,
      render: (keywords?: string[]) => (
        <Space wrap size={[4, 4]}>
          {(keywords ?? []).map((kw) => (
            <Tag key={kw}>{kw}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "内容",
      dataIndex: "content",
      ellipsis: true,
    },
    {
      title: "备注",
      dataIndex: "notes",
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v ?? "-",
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      width: 120,
      render: (_: unknown, record: KnowledgeEntry) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确认删除该知识条目？"
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
              placeholder="搜索关键词"
              prefix={<SearchOutlined />}
              allowClear
              value={filters.q}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, q: e.target.value || undefined }));
              }}
              style={{ width: 200 }}
            />
            <Select
              placeholder="分类筛选"
              allowClear
              value={filters.category}
              onChange={(v) => {
                setPage(1);
                setFilters((f) => ({ ...f, category: v }));
              }}
              options={categoryOptions}
              style={{ width: 120 }}
            />
          </Space>
          <Space>
            <Button
              icon={<SearchOutlined />}
              onClick={() => setSearchDrawerOpen(true)}
            >
              搜索测试
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新增知识
            </Button>
          </Space>
        </Space>
      </Card>

      <Card className="glass-card" variant="borderless">
        <Table<KnowledgeEntry>
          rowKey="id"
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
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
        <KnowledgeEditModal
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

      <Drawer
        open={searchDrawerOpen}
        title="知识搜索测试"
        onClose={() => setSearchDrawerOpen(false)}
        size={520}
      >
        <Space orientation="vertical" size={12} style={{ display: "flex" }}>
          <Space.Compact style={{ display: "flex" }}>
            <Input
              placeholder="输入搜索 query"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPressEnter={handleSearch}
            />
            <InputNumber
              min={1}
              max={50}
              value={searchLimit}
              onChange={(v) => setSearchLimit(v ?? 5)}
              style={{ width: 80 }}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={searchMutation.isPending}
              onClick={handleSearch}
            >
              搜索
            </Button>
          </Space.Compact>
          {searchMutation.data ? (
            searchMutation.data.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {searchMutation.data.map((item) => (
                  <div
                    key={`${item.id}-${item.source}`}
                    style={{
                      width: "100%",
                      paddingBottom: 12,
                      borderBottom: "1px solid #f0f0f0",
                    }}
                  >
                    <Space
                      orientation="vertical"
                      size={4}
                      style={{ display: "flex" }}
                    >
                      <Space wrap>
                        <Tag color={categoryColorMap[item.category as KnowledgeCategory]}>
                          {item.category}
                        </Tag>
                        <Tag>相似度 {item.similarity.toFixed(4)}</Tag>
                        <Tag color={item.source === "vector" ? "green" : "blue"}>
                          {item.source}
                        </Tag>
                      </Space>
                      <Typography.Paragraph
                        ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}
                        style={{ margin: 0 }}
                      >
                        {item.content}
                      </Typography.Paragraph>
                    </Space>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="暂无匹配结果" />
            )
          ) : null}
        </Space>
      </Drawer>
    </Space>
  );
}

interface KnowledgeEditModalProps {
  open: boolean;
  record: KnowledgeEntry | null;
  confirmLoading: boolean;
  onCancel: () => void;
  onSubmit: (values: KnowledgeCreateRequest) => Promise<void>;
}

function KnowledgeEditModal({
  open,
  record,
  confirmLoading,
  onCancel,
  onSubmit,
}: KnowledgeEditModalProps) {
  const [form] = Form.useForm<KnowledgeCreateRequest>();

  useEffect(() => {
    if (!open) {
      return;
    }

    if (record) {
      form.setFieldsValue({
        content: record.content,
        keywords: record.keywords ?? [],
        category: record.category,
        notes: record.notes ?? "",
      });
      return;
    }

    form.resetFields();
    form.setFieldsValue({ category: "general", keywords: [] });
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
      title={record ? "编辑知识" : "新增知识"}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      width={640}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="content"
          label="内容"
          rules={[{ required: true, message: "请输入知识内容" }]}
        >
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item name="keywords" label="关键词">
          <Select
            mode="tags"
            placeholder="输入关键词后回车"
            tokenSeparators={[",", "，"]}
          />
        </Form.Item>
        <Form.Item
          name="category"
          label="分类"
          rules={[{ required: true, message: "请选择分类" }]}
        >
          <Select options={categoryOptions} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
