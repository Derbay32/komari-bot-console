import type { FormRule } from "antd";

import type { components } from "@/types/komari-api";

export type KnowledgeCategory =
  components["schemas"]["KnowledgeEntry"]["category"];

export const knowledgeCustomCategoryLabel = "自定义";

export const knowledgeCategoryOptions: {
  value: KnowledgeCategory;
  label: string;
}[] = [
  { value: "general", label: "通用" },
  { value: "character", label: "角色" },
  { value: "setting", label: "设定" },
  { value: "plot", label: "剧情" },
  { value: "other", label: "其他" },
  { value: "custom", label: knowledgeCustomCategoryLabel },
];

export const knowledgeCategoryColorMap: Record<KnowledgeCategory, string> = {
  general: "volcano",
  character: "magenta",
  setting: "green",
  plot: "gold",
  other: "default",
  custom: "cyan",
};

const knowledgeKeywordsRequiredMessage = "请至少填写一个关键词";

export function hasNonEmptyKnowledgeKeywords(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (keyword) => typeof keyword === "string" && keyword.trim().length > 0,
    )
  );
}

export function validateKnowledgeKeywords(value: unknown): Promise<void> {
  return hasNonEmptyKnowledgeKeywords(value)
    ? Promise.resolve()
    : Promise.reject(new Error(knowledgeKeywordsRequiredMessage));
}

export const knowledgeKeywordsRules: FormRule[] = [
  { required: true, message: knowledgeKeywordsRequiredMessage },
  { validator: (_rule, value) => validateKnowledgeKeywords(value) },
];
