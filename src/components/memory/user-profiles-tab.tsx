"use client";

import { DeleteOutlined, EditOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Pagination,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useState } from "react";

import type { components } from "@/types/komari-api";
import { JsonEditorModal } from "@/components/json-editor-modal";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useDeleteUserProfile,
  usePutUserProfile,
  useUserProfile,
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

type UserProfileGroupSection = {
  groupId: string;
  users: UserProfileCardData[];
};

export function UserProfilesTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    group_id?: string;
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

  const listParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useUserProfileList(listParams);
  const detailQuery = useUserProfile(selectedUser?.groupId, selectedUser?.userId);
  const putMutation = usePutUserProfile();
  const deleteMutation = useDeleteUserProfile();

  const groupSections = buildUserProfileSections(listQuery.data?.items ?? []);
  const visibleUserCount = groupSections.reduce(
    (count, section) => count + section.users.length,
    0,
  );

  const activeProfile = detailQuery.data
    ? createUserProfileCardData([detailQuery.data])
    : selectedSummary;

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
    [editRecord, putMutation],
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
    [deleteMutation, handleCloseDetail, selectedUser],
  );

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <Card className="glass-card" variant="borderless">
        <Space wrap>
          <Input
            name="group_id"
            placeholder="Group ID"
            allowClear
            value={filters.group_id}
            onChange={(e) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                group_id: e.target.value || undefined,
              }));
            }}
            style={{ width: 160 }}
          />
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
            style={{ width: 160 }}
          />
          <Input
            name="user_profile_search"
            placeholder="搜索"
            allowClear
            prefix={<SearchOutlined />}
            value={filters.q}
            onChange={(e) => {
              setPage(1);
              setFilters((current) => ({ ...current, q: e.target.value || undefined }));
            }}
            style={{ width: 220 }}
          />
        </Space>
      </Card>

      {listQuery.isError ? (
        <Alert
          showIcon
          type="warning"
          message="用户画像加载失败"
          description={
            listQuery.error instanceof Error ? listQuery.error.message : "请稍后重试。"
          }
        />
      ) : null}

      {listQuery.isPending ? (
        <Card className="glass-card" variant="borderless" loading />
      ) : groupSections.length ? (
        groupSections.map((section) => (
          <Card
            key={section.groupId}
            className="glass-card"
            variant="borderless"
            title={`Group ID · ${section.groupId}`}
            extra={<Tag color="blue">{section.users.length} 位用户</Tag>}
          >
            <Row gutter={[16, 16]}>
              {section.users.map((profile) => (
                <Col xs={24} md={12} xl={8} key={`${profile.groupId}-${profile.userId}`}>
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
                    <Space orientation="vertical" size={12} style={{ display: "flex" }}>
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
        ))
      ) : (
        <Card className="glass-card" variant="borderless">
          <Empty description="暂无用户画像数据" />
        </Card>
      )}

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
            当前页展示 {visibleUserCount} 位用户，接口共返回 {listQuery.data?.total ?? 0} 条画像记录
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

function buildUserProfileSections(items: MemoryEntityEntry[]): UserProfileGroupSection[] {
  const groupMap = new Map<string, Map<string, MemoryEntityEntry[]>>();

  for (const item of items) {
    const groupUsers = groupMap.get(item.group_id) ?? new Map<string, MemoryEntityEntry[]>();
    const records = groupUsers.get(item.user_id) ?? [];

    records.push(item);
    groupUsers.set(item.user_id, records);
    groupMap.set(item.group_id, groupUsers);
  }

  return Array.from(groupMap.entries()).map(([groupId, users]) => ({
    groupId,
    users: Array.from(users.values())
      .map((records) => createUserProfileCardData(records))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, "zh-CN"),
      ),
  }));
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
