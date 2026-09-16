import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type AgentRunListResponse = components["schemas"]["AgentRunListResponse"];
type AgentRunDetail = components["schemas"]["AgentRunDetail"];

type AgentRunListParams = {
  date?: string | null;
  days?: number;
  run_type?: string | null;
  task_kind?: string | null;
  origin?: ("normal" | "debug") | null;
  trace_id?: string | null;
  status?: ("success" | "error" | "cancelled") | null;
  model?: string | null;
  method?: string | null;
  limit?: number;
  offset?: number;
};

export function useAgentRunList(params: AgentRunListParams) {
  return useQuery({
    queryKey: ["agent-runs", "list", params],
    queryFn: () =>
      apiFetch<AgentRunListResponse>("/api/agent-run-logs/v1/runs", {
        params: params as Record<string, string | number | null>,
      }),
  });
}

export function useAgentRun(runId: string | undefined) {
  return useQuery({
    queryKey: ["agent-runs", "detail", runId],
    queryFn: () =>
      apiFetch<AgentRunDetail>(`/api/agent-run-logs/v1/runs/${runId}`),
    enabled: !!runId,
  });
}
