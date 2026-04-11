import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type MemoryEntityEntry = components["schemas"]["MemoryEntityEntry"];
type MemoryEntityListResponse = components["schemas"]["MemoryEntityListResponse"];

type MemoryEntityListParams = {
  group_id?: string | null;
  user_id?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
};

export function useInteractionHistoryList(params: MemoryEntityListParams) {
  return useQuery({
    queryKey: ["interaction-histories", "list", params],
    queryFn: () =>
      apiFetch<MemoryEntityListResponse>(
        "/api/komari-memory/v1/interaction-histories",
        {
          params: params as Record<string, string | number | null>,
        },
      ),
  });
}

export function useInteractionHistory(
  groupId: string | undefined,
  userId: string | undefined,
) {
  return useQuery({
    queryKey: ["interaction-histories", "detail", groupId, userId],
    queryFn: () =>
      apiFetch<MemoryEntityEntry>(
        `/api/komari-memory/v1/interaction-histories/${groupId}/${userId}`,
      ),
    enabled: !!groupId && !!userId,
  });
}

export function usePutInteractionHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      userId,
      value,
      importance,
    }: {
      groupId: string;
      userId: string;
      value: { [key: string]: unknown };
      importance?: number;
    }) =>
      apiFetch<MemoryEntityEntry>(
        `/api/komari-memory/v1/interaction-histories/${groupId}/${userId}`,
        {
          method: "PUT",
          body: value,
          params: importance !== undefined ? { importance } : undefined,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["interaction-histories", "list"],
      });
    },
  });
}

export function useDeleteInteractionHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      userId,
    }: {
      groupId: string;
      userId: string;
    }) =>
      apiFetch<null>(
        `/api/komari-memory/v1/interaction-histories/${groupId}/${userId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["interaction-histories", "list"],
      });
    },
  });
}
