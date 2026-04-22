"use client";

import { SendOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import { useCallback, useMemo, useState } from "react";

import { getRequestErrorMessage } from "@/lib/http/error";
import { useGroupList, useSendMaintenanceAnnounce } from "@/lib/hooks/use-announce";
import type { components } from "@/types/komari-api";

type AnnounceResult = components["schemas"]["AnnounceResult"];
type GroupInfo = components["schemas"]["GroupInfo"];
type MaintenanceAnnounceRequest = components["schemas"]["MaintenanceAnnounceRequest"];
type MaintenanceAnnounceResponse = components["schemas"]["MaintenanceAnnounceResponse"];

type AnnounceFormValues = Omit<MaintenanceAnnounceRequest, "scheduled_time"> & {
  scheduled_time: [Dayjs, Dayjs];
};

export function AnnouncePage() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<AnnounceFormValues>();
  const [groupKeyword, setGroupKeyword] = useState("");
  const [lastResult, setLastResult] = useState<MaintenanceAnnounceResponse | null>(null);

  const groupsQuery = useGroupList();
  const sendMutation = useSendMaintenanceAnnounce();
  const watchedGroupIds = Form.useWatch("group_ids", form);
  const selectedGroupIds = useMemo(() => watchedGroupIds ?? [], [watchedGroupIds]);
  const groups = useMemo(() => groupsQuery.data?.groups ?? [], [groupsQuery.data?.groups]);
  const groupNameMap = useMemo(
    () => new Map(groups.map((group) => [group.group_id, group.group_name] as const)),
    [groups],
  );
  const selectedGroupText = useMemo(() => {
    if (!selectedGroupIds.length) {
      return "";
    }

    return selectedGroupIds
      .map((groupId) => {
        const groupName = groupNameMap.get(groupId);
        return groupName ? `${groupName} (${groupId})` : String(groupId);
      })
      .join("、");
  }, [groupNameMap, selectedGroupIds]);

  const filteredGroups = useMemo(() => {
    const keyword = groupKeyword.trim().toLowerCase();
    if (!keyword) {
      return groups;
    }

    return groups.filter((group) => {
      const name = group.group_name.toLowerCase();
      return name.includes(keyword) || String(group.group_id).includes(keyword);
    });
  }, [groupKeyword, groups]);

  const groupColumns: TableColumnsType<GroupInfo> = [
    {
      title: "群号",
      dataIndex: "group_id",
      width: 180,
    },
    {
      title: "群名",
      dataIndex: "group_name",
      ellipsis: true,
    },
    {
      title: "成员数",
      dataIndex: "member_count",
      width: 120,
    },
  ];

  const resultColumns: TableColumnsType<AnnounceResult> = [
    {
      title: "群号",
      dataIndex: "group_id",
      width: 180,
    },
    {
      title: "群名",
      width: 240,
      render: (_value, record) => groupNameMap.get(record.group_id) ?? "未知群聊",
    },
    {
      title: "状态",
      dataIndex: "success",
      width: 120,
      render: (success: boolean) => (
        <Tag color={success ? "success" : "error"}>{success ? "成功" : "失败"}</Tag>
      ),
    },
    {
      title: "错误信息",
      dataIndex: "error",
      render: (error: string | null | undefined) => error?.trim() || "-",
    },
  ];

  const handleSend = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) {
      return;
    }

    const payload: MaintenanceAnnounceRequest = {
      title: values.title.trim(),
      content: values.content.trim(),
      scheduled_time: `${values.scheduled_time[0].format("YYYY-MM-DD HH:mm")} ~ ${values.scheduled_time[1].format("YYYY-MM-DD HH:mm")}`,
      group_ids: values.group_ids,
    };

    modal.confirm({
      title: "确认发送维护通知",
      content: `将向 ${payload.group_ids.length} 个群发送维护通知，发送后不可撤回。`,
      okText: "确认发送",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await sendMutation.mutateAsync(payload);
          setLastResult(result);
          message.success(`通知发送完成：成功 ${result.success_count} 个，失败 ${result.failed_count} 个`);
        } catch (error) {
          message.error(getRequestErrorMessage(error, "发送维护通知失败"));
        }
      },
    });
  }, [form, message, modal, sendMutation]);

  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <Card className="glass-card" variant="borderless" title="群列表">
        <Space orientation="vertical" size={12} style={{ display: "flex" }}>
          <Typography.Text className="subtle-text">
            当前 Bot 已加入 {groupsQuery.data?.total ?? 0} 个群。
          </Typography.Text>
          <Table<GroupInfo>
            rowKey="group_id"
            columns={groupColumns}
            dataSource={groups}
            loading={groupsQuery.isPending}
            locale={{ emptyText: groupsQuery.isPending ? "加载中..." : <Empty description="暂无群数据" /> }}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个群`,
            }}
            scroll={{ x: 720 }}
          />
        </Space>
      </Card>

      <Card className="glass-card" variant="borderless" title="维护通知">
        <Form form={form} layout="vertical" initialValues={{ group_ids: [] }}>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: "请输入维护标题" }]}
          >
            <Input placeholder="例如：Komari 服务维护通知" maxLength={100} />
          </Form.Item>

          <Form.Item
            name="content"
            label="内容"
            extra="每行一条，发送时将按原始内容提交。"
            rules={[{ required: true, message: "请输入维护内容" }]}
          >
            <Input.TextArea
              rows={5}
              placeholder={"预计维护 10 分钟\n期间可能出现短暂不可用\n感谢理解与支持"}
            />
          </Form.Item>

          <Form.Item
            name="scheduled_time"
            label="预定时间"
            extra="按分钟选择维护时间区间。"
            rules={[
              { required: true, message: "请选择预定时间区间" },
              {
                validator: (_rule, value: [Dayjs, Dayjs] | undefined) => {
                  if (!value || value.length !== 2) {
                    return Promise.resolve();
                  }

                  return value[0].isBefore(value[1])
                    ? Promise.resolve()
                    : Promise.reject(new Error("结束时间必须晚于开始时间"));
                },
              },
            ]}
          >
            <DatePicker.RangePicker
              showTime={{ format: "HH:mm" }}
              style={{ width: "100%" }}
              placeholder={["选择开始时间", "选择结束时间"]}
              format="YYYY-MM-DD HH:mm"
            />
          </Form.Item>

          <Form.Item
            label="目标群"
            required
            extra={`已选 ${selectedGroupIds.length} 个群，可按群号或群名筛选。`}
          >
            <Space orientation="vertical" size={12} style={{ display: "flex" }}>
              <Input
                readOnly
                value={selectedGroupText}
                placeholder="勾选后将在这里显示已选目标群"
              />
              <Input
                placeholder="筛选群号 / 群名"
                allowClear
                value={groupKeyword}
                onChange={(event) => setGroupKeyword(event.target.value)}
              />
              <Form.Item
                name="group_ids"
                noStyle
                rules={[{ required: true, message: "请至少选择一个群" }]}
              >
                <Checkbox.Group style={{ width: "100%" }}>
                  <div
                    style={{
                      maxHeight: 240,
                      overflowY: "auto",
                      padding: 12,
                      border: "1px solid rgba(5, 5, 5, 0.06)",
                      borderRadius: 8,
                    }}
                  >
                    <Space orientation="vertical" size={8} style={{ display: "flex" }}>
                      {groupsQuery.isPending ? (
                        <Typography.Text type="secondary">群列表加载中...</Typography.Text>
                      ) : filteredGroups.length ? (
                        filteredGroups.map((group) => (
                          <Checkbox key={group.group_id} value={group.group_id}>
                            <Space size={8} wrap>
                              <Typography.Text>{group.group_name}</Typography.Text>
                              <Typography.Text type="secondary">
                                {group.group_id}
                              </Typography.Text>
                              <Tag>{group.member_count} 人</Tag>
                            </Space>
                          </Checkbox>
                        ))
                      ) : (
                        <Empty description="没有匹配的群" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      )}
                    </Space>
                  </div>
                </Checkbox.Group>
              </Form.Item>
            </Space>
          </Form.Item>

          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={sendMutation.isPending}
            onClick={handleSend}
          >
            发送通知
          </Button>
        </Form>
      </Card>

      {lastResult ? (
        <Card className="glass-card" variant="borderless" title="发送结果">
          <Space orientation="vertical" size={16} style={{ display: "flex" }}>
            <Alert
              type={lastResult.failed_count ? "warning" : "success"}
              showIcon
              title={`本次共处理 ${lastResult.total} 个群，成功 ${lastResult.success_count} 个，失败 ${lastResult.failed_count} 个。`}
            />
            <Space size={16} wrap>
              <Statistic title="总数" value={lastResult.total} />
              <Statistic
                title="成功"
                value={lastResult.success_count}
                styles={{ content: { color: "#3f8600" } }}
              />
              <Statistic
                title="失败"
                value={lastResult.failed_count}
                styles={{ content: { color: "#cf1322" } }}
              />
            </Space>
            <Table<AnnounceResult>
              rowKey="group_id"
              columns={resultColumns}
              dataSource={lastResult.results}
              pagination={false}
              scroll={{ x: 720 }}
            />
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}
