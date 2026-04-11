"use client";

import { DeleteOutlined, EditOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Drawer,
  Input,
  message,
  Popconfirm,
  Space,
  Table,
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
  useUserProfileList,
} from "@/lib/hooks/use-user-profiles";

type MemoryEntityEntry = components["schemas"]["MemoryEntityEntry"];

export function UserProfilesTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    group_id?: string;
    user_id?: string;
    q?: string;
  }>({});

  const [detailRecord, setDetailRecord] = useState<MemoryEntityEntry | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);

  const [editRecord, setEditRecord] = useState<MemoryEntityEntry | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const listParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = useUserProfileList(listParams);
  const putMutation = usePutUserProfile();
  const deleteMutation = useDeleteUserProfile();

  const handleViewDetail = useCallback((record: MemoryEntityEntry) => {
    setDetailRecord(record);
    setDetailDrawerOpen(true);
  }, []);

  const handleEdit = useCallback((record: MemoryEntityEntry) => {
    setEditRecord(record);
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
    async (record: MemoryEntityEntry) => {
      try {
        await deleteMutation.mutateAsync({
          groupId: record.group_id,
          userId: record.user_id,
        });
        message.success("用户画像删除成功");
      } catch (error) {
        message.error(getRequestErrorMessage(error, "用户画像删除失败"));
      }
    },
    [deleteMutation],
  );

  const columns = [
    { title: "User ID", dataIndex: "user_id", width: 160, ellipsis: true },
    { title: "Group ID", dataIndex: "group_id", width: 140, ellipsis: true },
    { title: "Key", dataIndex: "key", width: 140, ellipsis: true },
    { title: "Category", dataIndex: "category", width: 120 },
    {
      title: "重要性",
      dataIndex: "importance",
      width: 90,
      render: (v: number) => <Tag color={v >= 4 ? "red" : v >= 2 ? "blue" : "default"}>{v}</Tag>,
    },
    { title: "访问次数", dataIndex: "access_count", width: 100 },
    {
      title: "操作",
      width: 160,
      render: (_: unknown, record: MemoryEntityEntry) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确认删除该用户画像？"
            onConfirm={() => handleDelete(record)}
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
            placeholder="User ID"
            allowClear
            value={filters.user_id}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, user_id: e.target.value || undefined }));
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
            style={{ width: 200 }}
          />
        </Space>
      </Card>

      <Card className="glass-card" variant="borderless">
        <Table<MemoryEntityEntry>
          rowKey={(r) => `${r.group_id}-${r.user_id}-${r.key}`}
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 910 }}
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

      <Drawer
        open={detailDrawerOpen}
        title="用户画像详情"
        onClose={() => setDetailDrawerOpen(false)}
        size={600}
      >
        {detailRecord && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Typography.Text strong>User ID: </Typography.Text>
              <Typography.Text>{detailRecord.user_id}</Typography.Text>
            </div>
            <div>
              <Typography.Text strong>Group ID: </Typography.Text>
              <Typography.Text>{detailRecord.group_id}</Typography.Text>
            </div>
            <div>
              <Typography.Text strong>Key: </Typography.Text>
              <Typography.Text>{detailRecord.key}</Typography.Text>
            </div>
            <div>
              <Typography.Text strong>Category: </Typography.Text>
              <Typography.Text>{detailRecord.category}</Typography.Text>
            </div>
            <div>
              <Typography.Text strong>Importance: </Typography.Text>
              <Typography.Text>{detailRecord.importance}</Typography.Text>
            </div>
            <div>
              <Typography.Text strong>Access Count: </Typography.Text>
              <Typography.Text>{detailRecord.access_count}</Typography.Text>
            </div>
            <div>
              <Typography.Text strong>Value:</Typography.Text>
              <pre
                style={{
                  background: "#f5f5f5",
                  padding: 12,
                  borderRadius: 8,
                  overflow: "auto",
                  maxHeight: 400,
                }}
              >
                {JSON.stringify(detailRecord.value, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>

      {editRecord && (
        <JsonEditorModal
          open={editModalOpen}
          title={`编辑用户画像 - ${editRecord.user_id}`}
          value={editRecord.value}
          onCancel={() => {
            setEditModalOpen(false);
            setEditRecord(null);
          }}
          onOk={handleEditOk}
          confirmLoading={putMutation.isPending}
        />
      )}
    </Space>
  );
}
