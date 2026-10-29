"use client";

import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type * as React from "react";

import styles from "@/components/announce/announce.module.css";
import { observeCallback, observePromise } from "@/lib/async";
import { createRequestId } from "@/lib/http/audit";
import { ApiError } from "@/lib/http/client";
import { getRequestErrorMessage } from "@/lib/http/error";
import {
  useAnnouncementDetail,
  useCreateAnnouncement,
  useGroupList,
  useUpdateAnnouncement,
} from "@/lib/hooks/use-announce";
import {
  MaintenanceInputError,
  MAINTENANCE_GROUP_LIMIT,
  MAINTENANCE_TEXT_BUDGETS,
  formatMaintenanceShanghaiDateTimeLocal,
  formatMaintenanceTimestamp,
  getMaintenanceNoticeStatusLabel,
  parseMaintenanceCreateInput,
  parseMaintenanceShanghaiDateTimeLocal,
  parseMaintenanceUpdateInput,
  readMaintenanceConflictPayload,
  type MaintenanceCreateInput,
  type MaintenanceMode,
  type MaintenanceNotice,
  type MaintenanceNoticeSummary,
  type MaintenanceUpdateInput,
} from "@/lib/maintenance";

type ComposeFormValues = {
  title: string;
  content: string;
  maintenanceTime: string;
  groupIds: number[];
  mode: MaintenanceMode;
  plannedAt: string;
};

type PlannedAtBaseline = {
  plannedAt: number | null;
  text: string;
};

type EditConflict = {
  message: string;
  currentNotice: MaintenanceNoticeSummary | null;
};

const INITIAL_VALUES: ComposeFormValues = {
  content: "",
  groupIds: [],
  maintenanceTime: "",
  mode: "immediate",
  plannedAt: "",
  title: "",
};

export function AnnounceComposeModal({
  open,
  onClose,
  editNoticeId = null,
}: {
  open: boolean;
  onClose: () => void;
  editNoticeId?: string | null;
}) {
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm<ComposeFormValues>();
  const groupsQuery = useGroupList();
  const createMutation = useCreateAnnouncement();
  const updateMutation = useUpdateAnnouncement();
  const detailQuery = useAnnouncementDetail(editNoticeId);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [loadedNotice, setLoadedNotice] = useState<MaintenanceNotice | null>(
    null,
  );
  const [plannedAtBaseline, setPlannedAtBaseline] =
    useState<PlannedAtBaseline | null>(null);
  const [editConflict, setEditConflict] = useState<EditConflict | null>(null);
  const [editLoadFailed, setEditLoadFailed] = useState(false);
  const isEditing = editNoticeId !== null;
  const isSaving = isEditing
    ? updateMutation.isPending
    : createMutation.isPending;

  const detailError = detailQuery.error;
  const { refetch: refetchDetail } = detailQuery;

  const watchedTitle = Form.useWatch("title", form) ?? "";
  const watchedContent = Form.useWatch("content", form) ?? "";
  const watchedMaintenanceTime = Form.useWatch("maintenanceTime", form) ?? "";
  const watchedModeValue = Form.useWatch("mode", form);
  const watchedMode: MaintenanceMode =
    watchedModeValue === "scheduled" ? "scheduled" : "immediate";
  const watchedPlannedAt = Form.useWatch("plannedAt", form) ?? "";
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
  const plannedAtPreview = useMemo(() => {
    if (watchedMode !== "scheduled") {
      return "未设置";
    }

    const rawValue = watchedPlannedAt.trim();

    if (!rawValue) {
      return "尚未填写";
    }

    try {
      return `${formatMaintenanceTimestamp(
        parseMaintenanceShanghaiDateTimeLocal(rawValue),
      )}（UTC+8）`;
    } catch {
      return "时间格式无效";
    }
  }, [watchedMode, watchedPlannedAt]);
  const plannedAtInputType =
    isEditing && hasExtendedPlannedAtYear(plannedAtBaseline)
      ? "text"
      : "datetime-local";

  const applyEditNotice = useCallback(
    (notice: MaintenanceNotice) => {
      const plannedAtText =
        notice.plannedAt === null
          ? ""
          : formatMaintenanceShanghaiDateTimeLocal(notice.plannedAt);

      form.setFieldsValue({
        content: notice.content,
        groupIds: [...notice.groupIds],
        maintenanceTime: notice.maintenanceTime,
        mode: notice.mode,
        plannedAt: plannedAtText,
        title: notice.title,
      });
      setPlannedAtBaseline({
        plannedAt: notice.plannedAt,
        text: plannedAtText,
      });
      setLoadedNotice(notice);
      setEditLoadFailed(false);
      setEditConflict(
        notice.status === "upcoming"
          ? null
          : {
              currentNotice: notice,
              message: "通知当前状态不允许编辑。",
            },
      );
    },
    [form],
  );

  useEffect(() => {
    if (!open || editNoticeId === null || loadedNotice !== null) {
      return;
    }

    let cancelled = false;

    refetchDetail()
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (result.isError) {
          setEditLoadFailed(true);
          return;
        }

        const freshNotice = result.data?.notice;

        if (freshNotice) {
          applyEditNotice(freshNotice);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEditLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyEditNotice, editNoticeId, loadedNotice, open, refetchDetail]);

  const handleValuesChange = useCallback(() => {
    setSubmissionId(null);
  }, []);

  const handleReloadDetail = useCallback(async () => {
    const result = await refetchDetail();

    if (result.isError) {
      setEditLoadFailed(true);
      return;
    }

    if (result.data?.notice) {
      applyEditNotice(result.data.notice);
    }
  }, [applyEditNotice, refetchDetail]);

  const handleSubmit = useCallback(async () => {
    if (isSaving || (isEditing && (!loadedNotice || editConflict))) {
      return;
    }

    const values = await form.validateFields().catch(() => null);

    if (!values) {
      return;
    }

    const mode: MaintenanceMode =
      values.mode === "scheduled" ? "scheduled" : "immediate";

    if (isEditing) {
      if (!loadedNotice) {
        return;
      }

      let input: MaintenanceUpdateInput;

      try {
        const plannedAt = resolveEditPlannedAt(
          mode,
          values.plannedAt ?? "",
          plannedAtBaseline,
        );

        input = parseMaintenanceUpdateInput({
          ...values,
          mode,
          plannedAt,
          version: loadedNotice.version,
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

      try {
        await updateMutation.mutateAsync({
          id: loadedNotice.id,
          input,
        });
        observePromise(messageApi.success("修改已保存，等待执行。"));
        onClose();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const conflict = readMaintenanceConflictPayload(error.payload);

          setEditConflict(
            conflict ?? {
              currentNotice: null,
              message: getRequestErrorMessage(
                error,
                "保存维护通知修改失败。",
              ),
            },
          );
          observePromise(
            messageApi.error(
              conflict?.message ?? "通知状态已变化，请刷新后重试。",
            ),
          );
          return;
        }

        observePromise(
          messageApi.error(
            getRequestErrorMessage(error, "保存维护通知修改失败。"),
          ),
        );
      }

      return;
    }

    let input: MaintenanceCreateInput;

    try {
      const plannedAt =
        mode === "scheduled"
          ? parseMaintenanceShanghaiDateTimeLocal(values.plannedAt ?? "")
          : null;

      input = parseMaintenanceCreateInput({
        ...values,
        mode,
        plannedAt,
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
  }, [
    createMutation,
    editConflict,
    form,
    isEditing,
    isSaving,
    loadedNotice,
    messageApi,
    onClose,
    plannedAtBaseline,
    submissionId,
    updateMutation,
  ]);

  const submitDisabled =
    isEditing &&
    (!loadedNotice || editConflict !== null || editLoadFailed);

  return (
    <Modal
      open={open}
      centered
      width={1000}
      title={isEditing ? "编辑维护通知" : "新增维护通知"}
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
          loading={isSaving}
          disabled={submitDisabled}
          onClick={observeCallback(handleSubmit)}
        >
          {isEditing ? "保存修改" : "保存任务"}
        </Button>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        title={
          isEditing
            ? "保存只更新本地任务，不会立即发送。"
            : "提交只保存本地任务，由独立 Worker 执行。"
        }
        description={
          isEditing
            ? "编辑基于服务器上的最新版本。保存成功后，旧计划不会再执行，按最新内容与计划发送。"
            : "关闭弹窗、取消或按 Esc 都不会清空草稿；修改草稿会重置提交标识。定时发送按 Asia/Shanghai（UTC+8）计划时间执行。"
        }
      />

      {isEditing && !loadedNotice && !editLoadFailed ? (
        <Alert
          showIcon
          type="info"
          title="正在读取最新通知..."
          description="编辑始终基于服务器上的最新版本。"
        />
      ) : null}

      {isEditing && !loadedNotice && editLoadFailed ? (
        <Alert
          showIcon
          type="error"
          title="通知详情加载失败"
          description={getRequestErrorMessage(
            detailError,
            "请稍后重试。",
          )}
          action={
            <Button
              size="small"
              onClick={observeCallback(handleReloadDetail)}
            >
              重试
            </Button>
          }
        />
      ) : null}

      {editConflict ? (
        <Alert
          showIcon
          type="warning"
          title="通知状态已变化"
          description={describeEditConflict(editConflict)}
        />
      ) : null}

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
          name={isEditing ? "maintenance-edit" : "maintenance-create"}
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

          <Form.Item name="mode" label="发送方式">
            <Radio.Group>
              <Radio value="immediate">立即发送</Radio>
              <Radio value="scheduled">定时发送</Radio>
            </Radio.Group>
          </Form.Item>

          {watchedMode === "scheduled" ? (
            <Form.Item
              name="plannedAt"
              label="计划发送时间（Asia/Shanghai，UTC+8）"
              extra="按 UTC+8 解释日历时间，与浏览器所在时区无关。"
              rules={[
                { required: true, message: "请选择计划发送时间" },
              ]}
            >
              <Input type={plannedAtInputType} />
            </Form.Item>
          ) : null}
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
            <SummaryRow
              label="发送方式"
              value={watchedMode === "scheduled" ? "定时发送" : "立即发送"}
            />
            {watchedMode === "scheduled" ? (
              <SummaryRow label="计划发送" value={plannedAtPreview} />
            ) : null}
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

function hasExtendedPlannedAtYear(baseline: PlannedAtBaseline | null) {
  return baseline !== null && /^\d{5,6}-/.test(baseline.text);
}

function resolveEditPlannedAt(
  mode: MaintenanceMode,
  text: string,
  baseline: PlannedAtBaseline | null,
) {
  if (mode !== "scheduled") {
    return null;
  }

  const rawValue = text.trim();

  if (
    baseline &&
    baseline.plannedAt !== null &&
    rawValue === baseline.text.trim()
  ) {
    return baseline.plannedAt;
  }

  return parseMaintenanceShanghaiDateTimeLocal(rawValue);
}

function describeEditConflict(conflict: EditConflict) {
  if (!conflict.currentNotice) {
    return `${conflict.message} 请关闭后重新打开编辑。`;
  }

  const statusLabel = getMaintenanceNoticeStatusLabel(
    conflict.currentNotice.status,
    conflict.currentNotice.activity,
  );
  const currentState = `当前状态：${statusLabel}，版本 ${conflict.currentNotice.version}。`;

  if (conflict.currentNotice.status !== "upcoming") {
    return `${conflict.message} ${currentState}该通知已不可编辑，请关闭。`;
  }

  return `${conflict.message} ${currentState}请关闭后重新打开编辑。`;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
    </div>
  );
}
