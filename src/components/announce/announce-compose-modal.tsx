"use client";

import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useCallback, useMemo, useState } from "react";
import type * as React from "react";

import styles from "@/components/announce/announce.module.css";
import { observeCallback, observePromise } from "@/lib/async";
import { createRequestId } from "@/lib/http/audit";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useCreateAnnouncement,
  useGroupList,
} from "@/lib/hooks/use-announce";
import {
  MaintenanceInputError,
  MAINTENANCE_GROUP_LIMIT,
  MAINTENANCE_TEXT_BUDGETS,
  parseMaintenanceCreateInput,
  type MaintenanceCreateInput,
} from "@/lib/maintenance";

type ComposeFormValues = {
  title: string;
  content: string;
  maintenanceTime: string;
  groupIds: number[];
};

const INITIAL_VALUES: ComposeFormValues = {
  content: "",
  groupIds: [],
  maintenanceTime: "",
  title: "",
};

export function AnnounceComposeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm<ComposeFormValues>();
  const groupsQuery = useGroupList();
  const createMutation = useCreateAnnouncement();
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const watchedTitle = Form.useWatch("title", form) ?? "";
  const watchedContent = Form.useWatch("content", form) ?? "";
  const watchedMaintenanceTime = Form.useWatch("maintenanceTime", form) ?? "";
  const watchedGroupIdsValue = Form.useWatch("groupIds", form);
  const watchedGroupIds = useMemo(
    () => watchedGroupIdsValue ?? [],
    [watchedGroupIdsValue],
  );

  const groups = useMemo(
    () => groupsQuery.data?.groups ?? [],
    [groupsQuery.data?.groups],
  );
  const groupOptions = useMemo(
    () =>
      groups.map((group) => ({
        label: `${group.group_name}（${group.group_id}）`,
        value: group.group_id,
      })),
    [groups],
  );
  const groupNameMap = useMemo(
    () =>
      new Map(
        groups.map(
          (group) => [group.group_id, group.group_name] as const,
        ),
      ),
    [groups],
  );
  const selectedTargetText = useMemo(() => {
    if (watchedGroupIds.length === 0) {
      return "尚未选择目标群";
    }

    return watchedGroupIds
      .map((groupId) => {
        const name = groupNameMap.get(groupId);
        return name ? `${name}（${groupId}）` : String(groupId);
      })
      .join("、");
  }, [groupNameMap, watchedGroupIds]);

  const handleValuesChange = useCallback(() => {
    setSubmissionId(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);

    if (!values) {
      return;
    }

    let input: MaintenanceCreateInput;

    try {
      input = parseMaintenanceCreateInput({
        ...values,
        mode: "immediate",
        plannedAt: null,
      });
    } catch (error) {
      observePromise(
        messageApi.error(
          error instanceof MaintenanceInputError
            ? error.message
            : "通知内容无效。",
        ),
      );
      return;
    }

    const nextSubmissionId =
      submissionId ?? createRequestId("web-announce");
    setSubmissionId(nextSubmissionId);

    try {
      await createMutation.mutateAsync({
        input,
        submissionId: nextSubmissionId,
      });
      setSubmissionId(null);
      form.resetFields();
      observePromise(messageApi.success("任务已保存，等待执行。"));
      onClose();
    } catch (error) {
      observePromise(
        messageApi.error(
          getRequestErrorMessage(error, "保存维护通知失败。"),
        ),
      );
    }
  }, [createMutation, form, messageApi, onClose, submissionId]);

  return (
    <Modal
      open={open}
      centered
      width={1000}
      title="新增维护通知"
      destroyOnHidden={false}
      onCancel={onClose}
      wrapProps={{
        onKeyDownCapture: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (
            open &&
            event.key === "Escape" &&
            !event.nativeEvent.isComposing
          ) {
            // Prevent the browser Escape default while leaving dismissal to AntD.
            event.preventDefault();
          }
        },
      }}
      classNames={{ body: styles.modalBody }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={createMutation.isPending}
          onClick={observeCallback(handleSubmit)}
        >
          保存任务
        </Button>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        title="提交只保存本地任务，由独立 Worker 执行。"
        description="关闭弹窗、取消或按 Esc 都不会清空草稿；修改草稿会重置提交标识。"
      />

      {groupsQuery.isError ? (
        <Alert
          showIcon
          type="error"
          title="群列表加载失败"
          description={getRequestErrorMessage(
            groupsQuery.error,
            "请稍后重试。",
          )}
        />
      ) : null}

      <div className={styles.composeGrid}>
        <Form
          form={form}
          layout="vertical"
          initialValues={INITIAL_VALUES}
          requiredMark
          onValuesChange={handleValuesChange}
          className={styles.composeForm}
        >
          <Form.Item
            name="title"
            label="标题"
            extra={`最多 ${MAINTENANCE_TEXT_BUDGETS.title.maxCodepoints} 个字符。`}
            rules={[
              { required: true, whitespace: true, message: "请输入维护标题" },
            ]}
          >
            <Input placeholder="例如：Komari 服务维护通知" />
          </Form.Item>

          <Form.Item
            name="content"
            label="正文"
            extra={`最多 ${MAINTENANCE_TEXT_BUDGETS.content.maxCodepoints} 个字符；换行会保留，不解析 HTML。`}
            rules={[
              { required: true, whitespace: true, message: "请输入维护内容" },
            ]}
          >
            <Input.TextArea
              rows={7}
              placeholder={
                "预计维护 10 分钟\n期间可能出现短暂不可用\n感谢理解与支持"
              }
            />
          </Form.Item>

          <Form.Item
            name="maintenanceTime"
            label="维护时间"
            extra="按展示文本填写，例如 2026-11-01 22:00 - 23:00。"
            rules={[
              { required: true, whitespace: true, message: "请输入维护时间" },
            ]}
          >
            <Input placeholder="例如：2026-11-01 22:00 - 23:00" />
          </Form.Item>

          <Form.Item
            name="groupIds"
            label="目标群"
            extra={`最多 ${MAINTENANCE_GROUP_LIMIT} 个群；实际运行上限仍由上游校验。`}
            rules={[
              {
                validator: (_rule, value: number[] | undefined) =>
                  value && value.length > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error("请至少选择一个目标群")),
              },
            ]}
          >
            <Select
              mode="multiple"
              allowClear
              showSearch={{ optionFilterProp: "label" }}
              maxTagCount="responsive"
              loading={groupsQuery.isPending}
              placeholder="搜索并选择目标群"
              options={groupOptions}
            />
          </Form.Item>

          <Form.Item label="发送方式">
            <Tag color="processing">立即发送</Tag>
            <Typography.Text type="secondary">
              定时发送将在后续版本开放。
            </Typography.Text>
          </Form.Item>
        </Form>

        <section className={styles.previewPanel} aria-label="消息预览">
          <div className={styles.previewHeader}>
            <Typography.Text strong>消息预览</Typography.Text>
            <Tag>草稿</Tag>
          </div>

          <div className={styles.messageCard}>
            <div className={styles.messageTitle}>
              {watchedTitle.trim() || "标题将显示在这里"}
            </div>
            <div className={styles.messageBody}>
              {watchedContent.trim()
                ? watchedContent
                : "正文会按输入内容原样展示，换行保留。"}
            </div>
          </div>

          <div className={styles.previewMeta}>
            <SummaryRow
              label="维护时间"
              value={watchedMaintenanceTime.trim() || "尚未填写"}
            />
            <SummaryRow label="发送方式" value="立即发送" />
            <SummaryRow
              label="目标群"
              value={
                watchedGroupIds.length > 0
                  ? `${watchedGroupIds.length} 个`
                  : "尚未选择"
              }
            />
            <SummaryRow label="群聊列表" value={selectedTargetText} />
          </div>

          <Typography.Paragraph
            type="secondary"
            className={styles.previewHint}
          >
            本预览只展示已填写的标题与正文，不等同于上游最终组装的完整消息模板。
          </Typography.Paragraph>
        </section>
      </div>

      <Space size={8} wrap className={styles.modalFooterHint}>
        <Tag>提交后进入待发送队列</Tag>
        <Tag>不自动重试</Tag>
        <Tag>结果未知时需人工核对</Tag>
      </Space>
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
    </div>
  );
}
