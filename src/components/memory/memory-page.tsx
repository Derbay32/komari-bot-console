"use client";

import { Tabs } from "antd";

import { ConversationsTab } from "./conversations-tab";
import { UserProfilesTab } from "./user-profiles-tab";
import { InteractionHistoriesTab } from "./interaction-histories-tab";

export function MemoryPage() {
  return (
    <Tabs
      defaultActiveKey="conversations"
      items={[
        { key: "conversations", label: "对话记忆", children: <ConversationsTab /> },
        { key: "profiles", label: "用户画像", children: <UserProfilesTab /> },
        { key: "histories", label: "互动历史", children: <InteractionHistoriesTab /> },
      ]}
    />
  );
}
