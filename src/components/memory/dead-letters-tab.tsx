"use client";

import { RedoOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Grid,
  Popconfirm,
  Space,
  Table,
  Tag,
} from "antd";
import { useCallback, useState } from "react";

import type { components } from "@/types/komari-api";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useConversationDeadLetterList,
  useRequeueConversationDeadLetter,
} from "@/lib/hooks/use-conversation-dead-letters";

type ConversationDeadLetterEntry =
  components["schemas"]["ConversationDeadLetterEntry"];

export function DeadLettersTab() {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [limit, setLimit] = useState(100);

  const listQuery = useConversationDeadLetterList(limit);
  const requeueMutation = useRequeueConversationDeadLetter();

  const handleRequeue = useCallback(
    async (record: ConversationDeadLetterEntry) => {
      try {
        const result = await requeueMutation.mutateAsync({
          groupId: record.group_id,
          snapshotId: record.snapshot_id,
        });
        message.success(
          `已重新入队，恢复 ${result.restored_message_count} 条消息`,
        );
      } catch (error) {
        message.error(getRequestErrorMessage(error, "重新入队失败"));
      }
    },
    [message, requeueMutation],
  );

  const columns = [
    {
      title: "群组 ID",
      dataIndex: "group_id",
      width: 140,
    },
    {
      title: "快照 ID",
      dataIndex: "snapshot_id",
      ellipsis: true,
    },
    {
      title: "失败代码",
      dataIndex: "failure_code",
      width: 140,
      render: (v: string) => <Tag color="red">{v}</Tag>,
    },
    {
      title: "尝试次数",
      dataIndex: "attempt_count",
      width: 90,
    },
    {
      title: "失败时间",
      dataIndex: "failed_at_ms",
      width: 170,
      render: (v: number) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "消息数",
      dataIndex: "message_count",
      width: 80,
    },
    {
      title: "分块状态数",
      dataIndex: "chunk_state_count",
      width: 100,
    },
    {
      title: "操作",
      width: 110,
      render: (_: unknown, record: ConversationDeadLetterEntry) => (
        <Popconfirm
          title="确认重新入队该死信快照？"
          description="后端将重放该快照的对话落库流程"
          onConfirm={() => handleRequeue(record)}
        >
          <Button
            type="link"
            size="small"
            icon={<RedoOutlined />}
            loading={requeueMutation.isPending}
          >
            重新入队
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <Alert
        type="info"
        showIcon
        message="对话死信为对话落库失败的快照，重新入队后由后端重放落库流程。"
      />
      <Card className="glass-card" variant="borderless">
        <Space wrap>
          <span>加载数量上限：</span>
          <Button
            size="small"
            type={limit === 50 ? "primary" : "default"}
            onClick={() => setLimit(50)}
          >
            50
          </Button>
          <Button
            size="small"
            type={limit === 100 ? "primary" : "default"}
            onClick={() => setLimit(100)}
          >
            100
          </Button>
          <Button
            size="small"
            type={limit === 200 ? "primary" : "default"}
            onClick={() => setLimit(200)}
          >
            200
          </Button>
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
        <Table<ConversationDeadLetterEntry>
          rowKey={(r) => `${r.group_id}:${r.snapshot_id}`}
          columns={columns}
          dataSource={listQuery.data?.items}
          loading={listQuery.isPending}
          scroll={{ x: 980 }}
          size={isMobile ? "small" : "middle"}
          pagination={{
            pageSize: 20,
            simple: isMobile,
            showTotal: (t) => `共 ${t} 条`,
          }}
        />
      </Card>
    </Space>
  );
}
