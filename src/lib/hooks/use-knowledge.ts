import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type KnowledgeEntry = components["schemas"]["KnowledgeEntry"];
type KnowledgeListResponse = components["schemas"]["KnowledgeListResponse"];
type KnowledgeCreateRequest = components["schemas"]["KnowledgeCreateRequest"];
type KnowledgeUpdateRequest = components["schemas"]["KnowledgeUpdateRequest"];
type KnowledgeSearchHit = components["schemas"]["KnowledgeSearchHit"];
type KnowledgeSearchRequest = components["schemas"]["KnowledgeSearchRequest"];

type KnowledgeListParams = {
  q?: string | null;
  category?: ("general" | "character" | "setting" | "plot" | "other") | null;
  limit?: number;
  offset?: number;
};

export function useKnowledgeList(params: KnowledgeListParams) {
  return useQuery({
    queryKey: ["knowledge", "list", params],
    queryFn: () =>
      apiFetch<KnowledgeListResponse>("/api/komari-knowledge/v1/knowledge", {
        params: params as Record<string, string | number | null>,
      }),
  });
}

export function useKnowledge(kid: number | undefined) {
  return useQuery({
    queryKey: ["knowledge", "detail", kid],
    queryFn: () =>
      apiFetch<KnowledgeEntry>(`/api/komari-knowledge/v1/knowledge/${kid}`),
    enabled: kid !== undefined,
  });
}

export function useCreateKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: KnowledgeCreateRequest) =>
      apiFetch<KnowledgeEntry>("/api/komari-knowledge/v1/knowledge", {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "list"] });
    },
  });
}

export function useUpdateKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kid, data }: { kid: number; data: KnowledgeUpdateRequest }) =>
      apiFetch<KnowledgeEntry>(`/api/komari-knowledge/v1/knowledge/${kid}`, {
        method: "PATCH",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "list"] });
    },
  });
}

export function useDeleteKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kid: number) =>
      apiFetch<null>(`/api/komari-knowledge/v1/knowledge/${kid}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "list"] });
    },
  });
}

export function useSearchKnowledge() {
  return useMutation({
    mutationFn: (data: KnowledgeSearchRequest) =>
      apiFetch<KnowledgeSearchHit[]>("/api/komari-knowledge/v1/search", {
        method: "POST",
        body: data,
      }),
  });
}
