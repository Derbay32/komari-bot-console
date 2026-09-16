import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type InteractionEventListResponse =
  components["schemas"]["InteractionEventListResponse"];
type InteractionEventUpdateRequest =
  components["schemas"]["InteractionEventUpdateRequest"];

type InteractionListParams = {
  user_id?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
};

export function useInteractionList(params: InteractionListParams) {
  return useQuery({
    queryKey: ["interactions", "list", params],
    queryFn: () =>
      apiFetch<InteractionEventListResponse>(
        "/api/komari-memory/v1/interactions",
        { params: params as Record<string, string | number | null> },
      ),
  });
}

export function useUpdateInteractionEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      data,
    }: {
      eventId: number;
      data: InteractionEventUpdateRequest;
    }) =>
      apiFetch<components["schemas"]["InteractionEventEntry"]>(
        `/api/komari-memory/v1/interactions/${eventId}`,
        { method: "PATCH", body: data },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interactions"] });
    },
  });
}

export function useDeleteInteractionEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) =>
      apiFetch<null>(`/api/komari-memory/v1/interactions/${eventId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interactions"] });
    },
  });
}
