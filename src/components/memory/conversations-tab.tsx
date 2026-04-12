"use client";

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Menu,
  Modal,
  Pagination,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";

import type { components } from "@/types/komari-api";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useConversationList,
  useConversationGroupSummaryList,
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

type ConversationCardData = {
  displayParticipants: string[];
  id: number;
  importanceCurrent: number;
  importanceInitial: number;
  participantCount: number;
  startTime: string;
  endTime: string;
  summary: string;
  raw: ConversationEntry;
};

export function ConversationsTab() {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupKeyword, setGroupKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    participant?: string;
    q?: string;
  }>({});

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalReady, setEditModalReady] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ConversationEntry | null>(null);

  const groupSummaryQuery = useConversationGroupSummaryList();
  const groupSummaries = groupSummaryQuery.data ?? [];
  const activeGroupId =
    selectedGroupId && groupSummaries.some((summary) => summary.groupId === selectedGroupId)
      ? selectedGroupId
      : groupSummaries[0]?.groupId ?? null;
  const activeGroupSummary =
    groupSummaries.find((summary) => summary.groupId === activeGroupId) ?? null;

  const filteredGroupSummaries = groupSummaries.filter((summary) => {
    const keyword = groupKeyword.trim();
    return !keyword || summary.groupId.includes(keyword);
  });

  const listParams = {
    group_id: activeGroupId ?? undefined,
    participant: filters.participant,
    q: filters.q,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useConversationList(listParams);
  const createMutation = useCreateConversation();
  const updateMutation = useUpdateConversation();
  const deleteMutation = useDeleteConversation();

  const conversationCards = (listQuery.data?.items ?? [])
    .map((item) => createConversationCardData(item))
    .sort((left, right) => right.startTime.localeCompare(left.startTime));
  const visibleConversationCount = conversationCards.length;
  const isFiltering = Boolean(filters.participant || filters.q);

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setPage(1);
  }, []);

  const handleCreate = useCallback(() => {
    setEditModalReady(true);
    setEditingRecord(null);
    setEditModalOpen(true);
  }, []);

  const handleEdit = useCallback((record: ConversationEntry) => {
    setEditModalReady(true);
    setEditingRecord(record);
    setEditModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (values: ConversationFormValues) => {
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
    },
    [createMutation, editingRecord, updateMutation],
  );

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

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      {groupSummaryQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          message="群组菜单加载失败"
          description={
            groupSummaryQuery.error instanceof Error
              ? groupSummaryQuery.error.message
              : "请稍后重试。"
          }
        />
      ) : null}

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} lg={7} xl={6}>
          <Card
            className="glass-card"
            variant="borderless"
            title="群组菜单"
            extra={<Tag color="blue">{groupSummaries.length} 个群组</Tag>}
            loading={groupSummaryQuery.isPending}
          >
            <Space orientation="vertical" size={12} style={{ display: "flex" }}>
              <Input
                name="conversation_group_search"
                placeholder="筛选 Group ID"
                allowClear
                value={groupKeyword}
                onChange={(e) => {
                  setGroupKeyword(e.target.value);
                }}
              />

              {filteredGroupSummaries.length ? (
                <Menu
                  mode="inline"
                  selectedKeys={activeGroupId ? [activeGroupId] : []}
                  items={filteredGroupSummaries.map((summary) => ({
                    key: summary.groupId,
                    label: (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {summary.groupId}
                        </span>
                        <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                          {summary.conversationCount}
                        </Tag>
                      </div>
                    ),
                  }))}
                  onClick={({ key }) => {
                    handleSelectGroup(String(key));
                  }}
                  style={{
                    borderInlineEnd: "none",
                    background: "transparent",
                  }}
                />
              ) : (
                <Empty description={groupKeyword ? "没有匹配的群组" : "暂无群组数据"} />
              )}

              {activeGroupSummary ? (
                <Typography.Text className="subtle-text">
                  当前群共 {activeGroupSummary.conversationCount} 条对话
                </Typography.Text>
              ) : null}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={17} xl={18}>
          <Space orientation="vertical" size={16} style={{ display: "flex" }}>
            <Card className="glass-card" variant="borderless">
              <Space wrap style={{ display: "flex", justifyContent: "space-between" }}>
                <Space wrap>
                  <Input
                    name="conversation_participant"
                    placeholder="参与者"
                    allowClear
                    prefix={<SearchOutlined />}
                    value={filters.participant}
                    onChange={(e) => {
                      setPage(1);
                      setFilters((current) => ({
                        ...current,
                        participant: e.target.value || undefined,
                      }));
                    }}
                    style={{ width: 180 }}
                  />
                  <Input
                    name="conversation_search"
                    placeholder="搜索对话"
                    allowClear
                    prefix={<SearchOutlined />}
                    value={filters.q}
                    onChange={(e) => {
                      setPage(1);
                      setFilters((current) => ({
                        ...current,
                        q: e.target.value || undefined,
                      }));
                    }}
                    style={{ width: 240 }}
                  />
                </Space>

                <Space wrap size={[8, 8]}>
                  {activeGroupId ? <Tag color="geekblue">Group ID · {activeGroupId}</Tag> : null}
                  {activeGroupSummary ? (
                    <Tag color="blue">{activeGroupSummary.conversationCount} 条对话</Tag>
                  ) : null}
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                    新增对话
                  </Button>
                </Space>
              </Space>
            </Card>

            {listQuery.isError ? (
              <Alert
                showIcon
                type="warning"
                message="对话记忆加载失败"
                description={
                  listQuery.error instanceof Error ? listQuery.error.message : "请稍后重试。"
                }
              />
            ) : null}

            {!activeGroupId && groupSummaryQuery.isPending ? (
              <Card className="glass-card" variant="borderless" loading />
            ) : null}

            {!activeGroupId && !groupSummaryQuery.isPending ? (
              <Card className="glass-card" variant="borderless">
                <Empty description="暂无可用群组" />
              </Card>
            ) : null}

            {activeGroupId ? (
              listQuery.isPending ? (
                <Card className="glass-card" variant="borderless" loading />
              ) : conversationCards.length ? (
                <Card
                  className="glass-card"
                  variant="borderless"
                  title={`Group ID · ${activeGroupId}`}
                  extra={
                    activeGroupSummary ? (
                      <Tag color="blue">{activeGroupSummary.conversationCount} 条对话</Tag>
                    ) : null
                  }
                >
                  <Row gutter={[16, 16]}>
                    {conversationCards.map((conversation) => (
                      <Col xs={24} md={12} xl={8} key={conversation.id}>
                        <Card
                          className="glass-card module-card"
                          variant="borderless"
                          hoverable
                          extra={
                            <Space size={0}>
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => handleEdit(conversation.raw)}
                              >
                                编辑
                              </Button>
                              <Popconfirm
                                title="确认删除该对话？"
                                onConfirm={() => handleDelete(conversation.id)}
                              >
                                <Button
                                  type="link"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                >
                                  删除
                                </Button>
                              </Popconfirm>
                            </Space>
                          }
                        >
                          <Space orientation="vertical" size={12} style={{ display: "flex" }}>
                            <div>
                              <Typography.Title level={5} style={{ marginBottom: 8 }}>
                                对话 #{conversation.id}
                              </Typography.Title>
                              <Typography.Text className="subtle-text">
                                {formatDateTime(conversation.startTime)} ~ {formatDateTime(conversation.endTime)}
                              </Typography.Text>
                            </div>

                            <div>
                              <Typography.Text strong>参与者</Typography.Text>
                              <Typography.Paragraph style={{ margin: "8px 0 0" }}>
                                {formatParticipantPreview(
                                  conversation.displayParticipants,
                                  conversation.participantCount,
                                )}
                              </Typography.Paragraph>
                            </div>

                            <div>
                              <Typography.Text strong>摘要</Typography.Text>
                              <Typography.Paragraph
                                style={{
                                  margin: "8px 0 0",
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}
                              >
                                {conversation.summary}
                              </Typography.Paragraph>
                            </div>

                            <Space wrap size={[8, 8]}>
                              <Tag color="geekblue">{conversation.participantCount} 位参与者</Tag>
                              <Tag color={getImportanceColor(conversation.importanceCurrent)}>
                                当前重要性 {conversation.importanceCurrent}
                              </Tag>
                              <Tag>初始重要性 {conversation.importanceInitial}</Tag>
                            </Space>
                          </Space>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </Card>
              ) : (
                <Card
                  className="glass-card"
                  variant="borderless"
                  title={`Group ID · ${activeGroupId}`}
                  extra={
                    activeGroupSummary ? (
                      <Tag color="blue">{activeGroupSummary.conversationCount} 条对话</Tag>
                    ) : null
                  }
                >
                  <Empty description={isFiltering ? "当前筛选下暂无对话记忆" : "该群暂无对话记忆"} />
                </Card>
              )
            ) : null}

            {activeGroupId && !listQuery.isError ? (
              <Card className="glass-card" variant="borderless">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography.Text className="subtle-text">
                    当前群共 {activeGroupSummary?.conversationCount ?? 0} 条对话，
                    当前筛选命中 {listQuery.data?.total ?? 0} 条对话记录，
                    本页展示 {visibleConversationCount} 条对话
                  </Typography.Text>
                  <Pagination
                    current={page}
                    pageSize={pageSize}
                    total={listQuery.data?.total ?? 0}
                    showSizeChanger
                    showTotal={(total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`}
                    onChange={(nextPage, nextPageSize) => {
                      setPage(nextPage);
                      setPageSize(nextPageSize);
                    }}
                  />
                </div>
              </Card>
            ) : null}
          </Space>
        </Col>
      </Row>

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
          <Select mode="tags" placeholder="输入参与者后回车" tokenSeparators={[",", "，"]} />
        </Form.Item>
        <Form.Item
          name="importance_initial"
          label="初始重要性"
          rules={[{ required: true }]}
        >
          <InputNumber min={1} max={5} />
        </Form.Item>
        {record ? (
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
        ) : null}
      </Form>
    </Modal>
  );
}

function createConversationCardData(record: ConversationEntry): ConversationCardData {
  const parsedParticipants = (record.participants ?? []).map(getParticipantDisplayName);

  return {
    displayParticipants: parsedParticipants,
    id: record.id,
    importanceCurrent: record.importance_current,
    importanceInitial: record.importance_initial,
    participantCount: parsedParticipants.length,
    startTime: record.start_time,
    endTime: record.end_time,
    summary: record.summary,
    raw: record,
  };
}

function formatParticipantPreview(participants: string[], participantCount: number) {
  if (!participantCount) {
    return "暂无参与者";
  }

  const previewNames = participants.slice(0, 3).join("、");
  return participantCount > 3 ? `${previewNames} 等${participantCount}个用户` : previewNames;
}

function getParticipantDisplayName(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return value;
  }

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;
    if (isRecord(parsed)) {
      return (
        getOptionalString(parsed.display_name) ||
        getOptionalString(parsed.displayName) ||
        getOptionalString(parsed.name) ||
        getOptionalString(parsed.user_id) ||
        getOptionalString(parsed.userId) ||
        trimmedValue
      );
    }
  } catch {
    const segments = trimmedValue.split(/[|,]/).map((segment) => segment.trim()).filter(Boolean);
    if (segments.length >= 2) {
      return segments[1] ?? trimmedValue;
    }
  }

  return trimmedValue;
}

function getImportanceColor(value: number) {
  if (value >= 4) {
    return "red";
  }

  if (value >= 2) {
    return "blue";
  }

  return "default";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function getOptionalString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
