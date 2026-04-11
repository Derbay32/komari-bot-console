import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type ConversationEntry = components["schemas"]["ConversationEntry"];
type ConversationListResponse = components["schemas"]["ConversationListResponse"];
type ConversationCreateRequest = components["schemas"]["ConversationCreateRequest"];
type ConversationUpdateRequest = components["schemas"]["ConversationUpdateRequest"];

type ConversationListParams = {
  group_id?: string | null;
  participant?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
};

export function useConversationList(params: ConversationListParams) {
  return useQuery({
    queryKey: ["conversations", "list", params],
    queryFn: () =>
      apiFetch<ConversationListResponse>("/api/komari-memory/v1/conversations", {
        params: params as Record<string, string | number | null>,
      }),
  });
}

export function useConversation(conversationId: number | undefined) {
  return useQuery({
    queryKey: ["conversations", "detail", conversationId],
    queryFn: () =>
      apiFetch<ConversationEntry>(
        `/api/komari-memory/v1/conversations/${conversationId}`,
      ),
    enabled: conversationId !== undefined,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ConversationCreateRequest) =>
      apiFetch<ConversationEntry>("/api/komari-memory/v1/conversations", {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
    },
  });
}

export function useUpdateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      data,
    }: {
      conversationId: number;
      data: ConversationUpdateRequest;
    }) =>
      apiFetch<ConversationEntry>(
        `/api/komari-memory/v1/conversations/${conversationId}`,
        { method: "PATCH", body: data },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: number) =>
      apiFetch<null>(
        `/api/komari-memory/v1/conversations/${conversationId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
    },
  });
}
