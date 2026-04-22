"use client";

import { DeleteOutlined, EditOutlined, SearchOutlined } from "@ant-design/icons";
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Menu,
  Pagination,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { useCallback, useState } from "react";

import type { components } from "@/types/komari-api";
import { JsonEditorModal } from "@/components/json-editor-modal";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useDeleteUserProfile,
  usePutUserProfile,
  useUserProfile,
  useUserProfileGroupSummaryList,
  useUserProfileList,
} from "@/lib/hooks/use-user-profiles";

type MemoryEntityEntry = components["schemas"]["MemoryEntityEntry"];

type UserProfileTraitItem = {
  category?: string;
  description: string;
  importance?: number;
  name: string;
  updatedAt?: string;
};

type UserProfileCardData = {
  displayName: string;
  groupId: string;
  importance: number;
  lastAccessed?: string;
  record: MemoryEntityEntry;
  traitItems: UserProfileTraitItem[];
  userId: string;
};

type UserProfileGroupSummary = {
  groupId: string;
  userCount: number;
};

const EMPTY_GROUP_SUMMARIES: UserProfileGroupSummary[] = [];

export function UserProfilesTab() {
  const { message } = App.useApp();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupKeyword, setGroupKeyword] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    user_id?: string;
    q?: string;
  }>({});

  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    groupId: string;
    userId: string;
  } | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<UserProfileCardData | null>(
    null,
  );

  const [editRecord, setEditRecord] = useState<MemoryEntityEntry | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const groupSummaryQuery = useUserProfileGroupSummaryList();
  const groupSummaries = groupSummaryQuery.data ?? EMPTY_GROUP_SUMMARIES;
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
    user_id: filters.user_id,
    q: filters.q,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useUserProfileList(listParams, {
    enabled: !!activeGroupId,
  });
  const detailQuery = useUserProfile(selectedUser?.groupId, selectedUser?.userId);
  const putMutation = usePutUserProfile();
  const deleteMutation = useDeleteUserProfile();

  const profileCards = buildUserProfileCards(listQuery.data?.items ?? []);
  const visibleUserCount = profileCards.length;
  const isFiltering = Boolean(filters.user_id || filters.q);
  const activeProfile = detailQuery.data
    ? createUserProfileCardData([detailQuery.data])
    : selectedSummary;

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setPage(1);
    setDetailDrawerOpen(false);
    setSelectedUser(null);
    setSelectedSummary(null);
    setEditRecord(null);
    setEditModalOpen(false);
  }, []);

  const handleViewDetail = useCallback((profile: UserProfileCardData) => {
    setSelectedSummary(profile);
    setSelectedUser({ groupId: profile.groupId, userId: profile.userId });
    setDetailDrawerOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailDrawerOpen(false);
    setSelectedUser(null);
    setSelectedSummary(null);
  }, []);

  const handleStartEdit = useCallback((profile: UserProfileCardData | null) => {
    if (!profile) {
      return;
    }

    setEditRecord(profile.record);
    setEditModalOpen(true);
  }, []);

  const handleEditOk = useCallback(
    async (value: Record<string, unknown>) => {
      if (!editRecord) {
        return;
      }

      try {
        await putMutation.mutateAsync({
          groupId: editRecord.group_id,
          userId: editRecord.user_id,
          value,
          importance: editRecord.importance,
        });
        message.success("用户画像更新成功");
        setEditModalOpen(false);
        setEditRecord(null);
      } catch (error) {
        message.error(getRequestErrorMessage(error, "用户画像更新失败"));
      }
    },
    [editRecord, message, putMutation],
  );

  const handleDelete = useCallback(
    async (profile: UserProfileCardData) => {
      try {
        await deleteMutation.mutateAsync({
          groupId: profile.groupId,
          userId: profile.userId,
        });
        message.success("用户画像删除成功");
        setEditModalOpen(false);
        setEditRecord(null);

        if (
          selectedUser?.groupId === profile.groupId &&
          selectedUser.userId === profile.userId
        ) {
          handleCloseDetail();
        }
      } catch (error) {
        message.error(getRequestErrorMessage(error, "用户画像删除失败"));
      }
    },
    [deleteMutation, handleCloseDetail, message, selectedUser],
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
                name="user_profile_group_search"
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
                          {summary.userCount}
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
                <Empty
                  description={groupKeyword ? "没有匹配的群组" : "暂无群组数据"}
                />
              )}

              {activeGroupSummary ? (
                <Typography.Text className="subtle-text">
                  当前群共 {activeGroupSummary.userCount} 位用户
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
                    name="user_id"
                    placeholder="User ID"
                    allowClear
                    value={filters.user_id}
                    onChange={(e) => {
                      setPage(1);
                      setFilters((current) => ({
                        ...current,
                        user_id: e.target.value || undefined,
                      }));
                    }}
                    style={{ width: 180 }}
                  />
                  <Input
                    name="user_profile_search"
                    placeholder="搜索画像"
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
                  {activeGroupId ? (
                    <Tag color="geekblue">Group ID · {activeGroupId}</Tag>
                  ) : null}
                  {activeGroupSummary ? (
                    <Tag color="blue">{activeGroupSummary.userCount} 位用户</Tag>
                  ) : null}
                </Space>
              </Space>
            </Card>

            {listQuery.isError ? (
              <Alert
                showIcon
                type="warning"
                message="用户画像加载失败"
                description={
                  listQuery.error instanceof Error
                    ? listQuery.error.message
                    : "请稍后重试。"
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
              ) : profileCards.length ? (
                <Card
                  className="glass-card"
                  variant="borderless"
                  title={`Group ID · ${activeGroupId}`}
                  extra={
                    activeGroupSummary ? (
                      <Tag color="blue">{activeGroupSummary.userCount} 位用户</Tag>
                    ) : null
                  }
                >
                  <Row gutter={[16, 16]}>
                    {profileCards.map((profile) => (
                      <Col
                        xs={24}
                        md={12}
                        xl={8}
                        key={`${profile.groupId}-${profile.userId}`}
                      >
                        <Card
                          className="glass-card module-card"
                          variant="borderless"
                          hoverable
                          extra={
                            <Button type="link" onClick={() => handleViewDetail(profile)}>
                              查看画像
                            </Button>
                          }
                        >
                          <Space
                            orientation="vertical"
                            size={12}
                            style={{ display: "flex" }}
                          >
                            <div>
                              <Typography.Title level={5} style={{ marginBottom: 8 }}>
                                {profile.displayName}
                              </Typography.Title>
                              <Typography.Text className="subtle-text">
                                用户 ID：{profile.userId}
                              </Typography.Text>
                            </div>

                            <div>
                              <Typography.Text strong>用户画像</Typography.Text>
                              <Typography.Paragraph
                                style={{ margin: "8px 0 0" }}
                                ellipsis={{ rows: 3 }}
                              >
                                {getTraitPreview(profile)}
                              </Typography.Paragraph>
                            </div>

                            <Space wrap size={[8, 8]}>
                              <Tag color="geekblue">{profile.traitItems.length} 条画像</Tag>
                              <Tag color={getImportanceColor(profile.importance)}>
                                重要性 {profile.importance}
                              </Tag>
                              <Tag>{formatDateTime(profile.lastAccessed)}</Tag>
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
                      <Tag color="blue">{activeGroupSummary.userCount} 位用户</Tag>
                    ) : null
                  }
                >
                  <Empty
                    description={
                      isFiltering ? "当前筛选下暂无用户画像" : "该群暂无用户画像"
                    }
                  />
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
                    当前群共 {activeGroupSummary?.userCount ?? 0} 位用户，
                    当前筛选命中 {listQuery.data?.total ?? 0} 条画像记录，
                    本页展示 {visibleUserCount} 位用户
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

      <Drawer
        open={detailDrawerOpen}
        title={activeProfile ? `用户画像 · ${activeProfile.displayName}` : "用户画像详情"}
        onClose={handleCloseDetail}
        size={720}
        extra={
          activeProfile ? (
            <Space wrap>
              <Button
                icon={<EditOutlined />}
                onClick={() => handleStartEdit(activeProfile)}
              >
                编辑画像
              </Button>
              <Popconfirm
                title="确认删除该用户画像？"
                onConfirm={() => handleDelete(activeProfile)}
              >
                <Button danger icon={<DeleteOutlined />}>
                  删除画像
                </Button>
              </Popconfirm>
            </Space>
          ) : null
        }
      >
        {detailQuery.isPending && !detailQuery.data ? (
          <Typography.Text>加载中...</Typography.Text>
        ) : null}

        {detailQuery.isError ? (
          <Alert
            showIcon
            type="error"
            message="用户画像详情加载失败"
            description={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "请稍后重试。"
            }
          />
        ) : null}

        {activeProfile ? (
          <Space orientation="vertical" size={16} style={{ display: "flex" }}>
            <Card className="glass-card" variant="borderless">
              <Space orientation="vertical" size={8} style={{ display: "flex" }}>
                <div>
                  <Typography.Text strong>用户名：</Typography.Text>
                  <Typography.Text>{activeProfile.displayName}</Typography.Text>
                </div>
                <div>
                  <Typography.Text strong>User ID：</Typography.Text>
                  <Typography.Text>{activeProfile.userId}</Typography.Text>
                </div>
                <div>
                  <Typography.Text strong>Group ID：</Typography.Text>
                  <Typography.Text>{activeProfile.groupId}</Typography.Text>
                </div>
                <div>
                  <Typography.Text strong>重要性：</Typography.Text>
                  <Tag color={getImportanceColor(activeProfile.importance)}>
                    {activeProfile.importance}
                  </Tag>
                </div>
                <div>
                  <Typography.Text strong>最近访问：</Typography.Text>
                  <Typography.Text>
                    {formatDateTime(activeProfile.lastAccessed)}
                  </Typography.Text>
                </div>
              </Space>
            </Card>

            <Card
              className="glass-card"
              variant="borderless"
              title={`用户画像 (${activeProfile.traitItems.length})`}
            >
              {activeProfile.traitItems.length ? (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {activeProfile.traitItems.map((trait, index) => (
                    <div
                      key={trait.name}
                      style={{
                        padding: "14px 0",
                        borderBottom:
                          index === activeProfile.traitItems.length - 1
                            ? "none"
                            : "1px solid #f0f0f0",
                      }}
                    >
                      <Space wrap size={[8, 8]}>
                        <Typography.Text strong>{trait.name}</Typography.Text>
                        {trait.category ? <Tag>{trait.category}</Tag> : null}
                        {typeof trait.importance === "number" ? (
                          <Tag color={getImportanceColor(trait.importance)}>
                            重要性 {trait.importance}
                          </Tag>
                        ) : null}
                      </Space>
                      <Typography.Paragraph
                        style={{
                          margin: "8px 0 4px",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {trait.description}
                      </Typography.Paragraph>
                      {trait.updatedAt ? (
                        <Typography.Text className="subtle-text">
                          更新时间：{formatDateTime(trait.updatedAt)}
                        </Typography.Text>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="暂无用户画像内容" />
              )}
            </Card>
          </Space>
        ) : null}
      </Drawer>

      {editRecord ? (
        <JsonEditorModal
          open={editModalOpen}
          title={`编辑用户画像 - ${activeProfile?.displayName ?? editRecord.user_id}`}
          value={editRecord.value}
          onCancel={() => {
            setEditModalOpen(false);
            setEditRecord(null);
          }}
          onOk={handleEditOk}
          confirmLoading={putMutation.isPending}
        />
      ) : null}
    </Space>
  );
}

function buildUserProfileCards(items: MemoryEntityEntry[]) {
  const userMap = new Map<string, MemoryEntityEntry[]>();

  for (const item of items) {
    const records = userMap.get(item.user_id) ?? [];
    records.push(item);
    userMap.set(item.user_id, records);
  }

  return Array.from(userMap.values())
    .map((records) => createUserProfileCardData(records))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
}

function createUserProfileCardData(records: MemoryEntityEntry[]): UserProfileCardData {
  const [firstRecord] = records;
  const traitMap = new Map<string, UserProfileTraitItem>();
  let displayName = firstRecord.user_id;
  let lastAccessed = firstRecord.last_accessed ?? undefined;
  let importance = firstRecord.importance;

  for (const record of records) {
    const parsedValue = parseUserProfileValue(record.value);
    displayName = parsedValue.displayName || displayName;
    importance = Math.max(importance, record.importance);

    if (record.last_accessed && (!lastAccessed || record.last_accessed > lastAccessed)) {
      lastAccessed = record.last_accessed;
    }

    for (const trait of parsedValue.traitItems) {
      const currentTrait = traitMap.get(trait.name);
      if (!currentTrait || shouldReplaceTrait(currentTrait, trait)) {
        traitMap.set(trait.name, trait);
      }
    }
  }

  return {
    displayName,
    groupId: firstRecord.group_id,
    importance,
    lastAccessed,
    record: firstRecord,
    traitItems: Array.from(traitMap.values()),
    userId: firstRecord.user_id,
  };
}

function parseUserProfileValue(value: MemoryEntityEntry["value"]) {
  const root = isRecord(value) ? value : {};
  const traitsRoot = isRecord(root.traits) ? root.traits : {};

  return {
    displayName: getOptionalString(root.display_name),
    traitItems: Object.entries(traitsRoot).map(([name, trait]) => {
      const traitRecord = isRecord(trait) ? trait : {};

      return {
        category: getOptionalString(traitRecord.category),
        description: formatUnknownValue(traitRecord.value),
        importance: getOptionalNumber(traitRecord.importance),
        name,
        updatedAt: getOptionalString(traitRecord.updated_at),
      };
    }),
  };
}

function shouldReplaceTrait(current: UserProfileTraitItem, next: UserProfileTraitItem) {
  const currentUpdatedAt = current.updatedAt ?? "";
  const nextUpdatedAt = next.updatedAt ?? "";

  if (!currentUpdatedAt && nextUpdatedAt) {
    return true;
  }

  return nextUpdatedAt > currentUpdatedAt;
}

function getTraitPreview(profile: UserProfileCardData) {
  if (!profile.traitItems.length) {
    return "暂无画像内容";
  }

  if (profile.traitItems.length === 1) {
    return profile.traitItems[0]?.name ?? "暂无画像内容";
  }

  const previewNames = profile.traitItems.slice(0, 3).map((trait) => trait.name).join("、");
  return profile.traitItems.length > 3
    ? `${previewNames} 等 ${profile.traitItems.length} 项`
    : previewNames;
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

function formatUnknownValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "暂无内容";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "暂无内容";
  }
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

function getOptionalNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
