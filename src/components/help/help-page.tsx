"use client";

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useCreateHelp,
  useDeleteHelp,
  useHelpList,
  useScanHelp,
  useSearchHelp,
  useUpdateHelp,
} from "@/lib/hooks/use-help";
import type { components } from "@/types/komari-api";

type HelpEntry = components["schemas"]["HelpEntry"];
type HelpCreateRequest = components["schemas"]["HelpCreateRequest"];
type HelpCategory = "command" | "feature" | "faq" | "other";
type HelpSearchResult = components["schemas"]["HelpSearchResult"];

const categoryOptions: { value: HelpCategory; label: string }[] = [
  { value: "command", label: "命令" },
  { value: "feature", label: "功能" },
  { value: "faq", label: "常见问题" },
  { value: "other", label: "其他" },
];

const categoryColorMap: Record<HelpCategory, string> = {
  command: "blue",
  feature: "green",
  faq: "purple",
  other: "default",
};

export function HelpPage() {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{ q?: string; category?: HelpCategory }>({});

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalReady, setEditModalReady] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HelpEntry | null>(null);

  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(5);

  const listParams = useMemo(
    () => ({
      ...filters,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [filters, page, pageSize],
  );

  const listQuery = useHelpList(listParams);
  const createMutation = useCreateHelp();
  const updateMutation = useUpdateHelp();
  const deleteMutation = useDeleteHelp();
  const searchMutation = useSearchHelp();
  const scanMutation = useScanHelp();

  const handleCreate = useCallback(() => {
    setEditModalReady(true);
    setEditingRecord(null);
    setEditModalOpen(true);
  }, []);

  const handleEdit = useCallback((record: HelpEntry) => {
    setEditModalReady(true);
    setEditingRecord(record);
    setEditModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (values: HelpCreateRequest) => {
      try {
        if (editingRecord) {
          await updateMutation.mutateAsync({ hid: editingRecord.id, data: values });
          message.success("帮助条目更新成功");
        } else {
          await createMutation.mutateAsync(values);
          message.success("帮助条目创建成功");
        }
        setEditModalOpen(false);
        setEditingRecord(null);
      } catch (error) {
        message.error(
          getRequestErrorMessage(
            error,
            editingRecord ? "帮助条目更新失败" : "帮助条目创建失败",
          ),
        );
      }
    },
    [createMutation, editingRecord, message, updateMutation],
  );

  const handleDelete = useCallback(
    async (hid: number) => {
      try {
        await deleteMutation.mutateAsync(hid);
        message.success("帮助条目删除成功");
      } catch (error) {
        message.error(getRequestErrorMessage(error, "帮助条目删除失败"));
      }
    },
    [deleteMutation, message],
  );

  const handleScan = useCallback(async () => {
    try {
      const result = await scanMutation.mutateAsync();
      message.success(`扫描完成，更新 ${result.updated_count} 条帮助文档`);
    } catch (error) {
      message.error(getRequestErrorMessage(error, "扫描帮助文档失败"));
    }
  }, [message, scanMutation]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      message.warning("请输入搜索内容");
      return;
    }

    try {
      await searchMutation.mutateAsync({
        query: searchQuery.trim(),
        limit: searchLimit,
      });
    } catch (error) {
      message.error(getRequestErrorMessage(error, "帮助文档搜索失败"));
    }
  }, [message, searchLimit, searchMutation, searchQuery]);

  const columns: TableColumnsType<HelpEntry> = [
    {
      title: "ID",
      dataIndex: "id",
      width: 70,
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 100,
      render: (category: HelpCategory) => (
        <Tag color={categoryColorMap[category]}>
          {categoryOptions.find((item) => item.value === category)?.label ?? category}
        </Tag>
      ),
    },
    {
      title: "标题",
      dataIndex: "title",
      width: 220,
      ellipsis: true,
    },
    {
      title: "关键词",
      dataIndex: "keywords",
      width: 220,
      render: (keywords?: string[]) => (
        <Space wrap size={[4, 4]}>
          {(keywords ?? []).map((keyword) => (
            <Tag key={keyword}>{keyword}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "插件名",
      dataIndex: "plugin_name",
      width: 140,
      ellipsis: true,
      render: (value: string | null | undefined) => value ?? "-",
    },
    {
      title: "自动生成",
      dataIndex: "is_auto_generated",
      width: 110,
      render: (value: boolean) => (
        <Tag color={value ? "gold" : "default"}>{value ? "是" : "否"}</Tag>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 170,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      width: 120,
      render: (_value, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm title="确认删除该帮助条目？" onConfirm={() => handleDelete(record.id)}>
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
                setFilters((current) => ({ ...current, q: e.target.value || undefined }));
              }}
              style={{ width: 220 }}
            />
            <Select
              placeholder="分类筛选"
              allowClear
              value={filters.category}
              onChange={(value) => {
                setPage(1);
                setFilters((current) => ({ ...current, category: value }));
              }}
              options={categoryOptions}
              style={{ width: 140 }}
            />
          </Space>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              loading={scanMutation.isPending}
              onClick={handleScan}
            >
              扫描生成
            </Button>
            <Button icon={<SearchOutlined />} onClick={() => setSearchDrawerOpen(true)}>
              搜索测试
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新增帮助
            </Button>
          </Space>
        </Space>
      </Card>

      <Card className="glass-card" variant="borderless">
        <Table<HelpEntry>
          rowKey="id"
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 1180 }}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
        />
      </Card>

      {editModalReady ? (
        <HelpEditModal
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
        title="帮助文档搜索测试"
        onClose={() => setSearchDrawerOpen(false)}
        size={540}
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
              onChange={(value) => setSearchLimit(value ?? 5)}
              style={{ width: 88 }}
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
              <HelpSearchResultList items={searchMutation.data} />
            ) : (
              <Empty description="暂无匹配结果" />
            )
          ) : null}
        </Space>
      </Drawer>
    </Space>
  );
}

interface HelpEditModalProps {
  open: boolean;
  record: HelpEntry | null;
  confirmLoading: boolean;
  onCancel: () => void;
  onSubmit: (values: HelpCreateRequest) => Promise<void>;
}

function HelpEditModal({
  open,
  record,
  confirmLoading,
  onCancel,
  onSubmit,
}: HelpEditModalProps) {
  const [form] = Form.useForm<HelpCreateRequest>();

  useEffect(() => {
    if (!open) {
      return;
    }

    if (record) {
      form.setFieldsValue({
        title: record.title,
        content: record.content,
        category: record.category,
        keywords: record.keywords ?? [],
        plugin_name: record.plugin_name ?? undefined,
        notes: record.notes ?? undefined,
      });
      return;
    }

    form.resetFields();
    form.setFieldsValue({ category: "other", keywords: [] });
  }, [form, open, record]);

  const handleOk = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) {
      return;
    }

    await onSubmit({
      ...values,
      plugin_name: values.plugin_name?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
    });
  }, [form, onSubmit]);

  return (
    <Modal
      open={open}
      title={record ? "编辑帮助条目" : "新增帮助条目"}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      width={720}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: "请输入标题" }]}
        >
          <Input placeholder="例如：如何配置群聊欢迎词" />
        </Form.Item>
        <Form.Item
          name="content"
          label="内容"
          rules={[{ required: true, message: "请输入帮助内容" }]}
        >
          <Input.TextArea rows={6} />
        </Form.Item>
        <Form.Item name="category" label="分类" rules={[{ required: true, message: "请选择分类" }]}> 
          <Select options={categoryOptions} />
        </Form.Item>
        <Form.Item name="keywords" label="关键词">
          <Select mode="tags" placeholder="输入关键词后回车" tokenSeparators={[",", "，"]} />
        </Form.Item>
        <Form.Item name="plugin_name" label="插件名">
          <Input placeholder="可选，例如 weather" />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function HelpSearchResultList({ items }: { items: HelpSearchResult[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((item) => (
        <div
          key={`${item.id}-${item.source}`}
          style={{
            width: "100%",
            paddingBottom: 12,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Space orientation="vertical" size={4} style={{ display: "flex" }}>
            <Space wrap>
              <Tag color={categoryColorMap[item.category]}>
                {categoryOptions.find((option) => option.value === item.category)?.label ?? item.category}
              </Tag>
              <Tag>{item.title}</Tag>
              <Tag color={item.source === "vector" ? "green" : "blue"}>{item.source}</Tag>
              <Tag>相似度 {item.similarity.toFixed(4)}</Tag>
              {item.plugin_name ? <Tag>{item.plugin_name}</Tag> : null}
            </Space>
            <Typography.Paragraph strong style={{ margin: 0 }}>
              {item.title}
            </Typography.Paragraph>
            <Typography.Paragraph
              ellipsis={{ rows: 4, expandable: true, symbol: "展开" }}
              style={{ margin: 0 }}
            >
              {item.content}
            </Typography.Paragraph>
          </Space>
        </div>
      ))}
    </div>
  );
}
