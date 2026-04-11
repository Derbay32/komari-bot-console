import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type ReplyLogListResponse = components["schemas"]["ReplyLogListResponse"];
type ReplyLogDetail = components["schemas"]["ReplyLogDetail"];

type ReplyLogListParams = {
  date?: string | null;
  days?: number;
  trace_id?: string | null;
  model?: string | null;
  method?: string | null;
  status?: ("success" | "error") | null;
  limit?: number;
  offset?: number;
};

export function useReplyLogList(params: ReplyLogListParams) {
  return useQuery({
    queryKey: ["reply-logs", "list", params],
    queryFn: () =>
      apiFetch<ReplyLogListResponse>("/api/llm-provider/v1/reply-logs", {
        params: params as Record<string, string | number | null>,
      }),
  });
}

export function useReplyLog(
  date: string | undefined,
  lineNumber: number | undefined,
) {
  return useQuery({
    queryKey: ["reply-logs", "detail", date, lineNumber],
    queryFn: () =>
      apiFetch<ReplyLogDetail>(
        `/api/llm-provider/v1/reply-logs/${date}/${lineNumber}`,
      ),
    enabled: !!date && lineNumber !== undefined,
  });
}
