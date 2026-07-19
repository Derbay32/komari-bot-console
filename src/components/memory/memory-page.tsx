"use client";

import { Tabs, Typography } from "antd";

import { ConversationsTab } from "./conversations-tab";
import { UserProfilesTab } from "./user-profiles-tab";
import { InteractionHistoriesTab } from "./interaction-histories-tab";

export function MemoryPage() {
  return (
    <div className="memory-page">
      <div className="page-header">
        <div className="page-header__main">
          <Typography.Title level={2} className="page-title">
            记忆中心
          </Typography.Title>
          <p className="page-description">
            对话记忆、用户画像与互动历史——都是小鞠重要的回忆哦
          </p>
        </div>
      </div>
      <Tabs
        defaultActiveKey="conversations"
        items={[
          { key: "conversations", label: "对话记忆", children: <ConversationsTab /> },
          { key: "profiles", label: "用户画像", children: <UserProfilesTab /> },
          { key: "histories", label: "互动历史", children: <InteractionHistoriesTab /> },
        ]}
      />
    </div>
  );
}
