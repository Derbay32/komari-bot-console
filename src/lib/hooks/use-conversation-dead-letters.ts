import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { observePromise } from "@/lib/async";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type ConversationDeadLetterListResponse =
  components["schemas"]["ConversationDeadLetterListResponse"];
type ConversationDeadLetterRequeueResponse =
  components["schemas"]["ConversationDeadLetterRequeueResponse"];

export function useConversationDeadLetterList(limit?: number) {
  return useQuery({
    queryKey: ["conversation-dead-letters", "list", limit],
    queryFn: () =>
      apiFetch<ConversationDeadLetterListResponse>(
        "/api/komari-memory/v1/conversation-dead-letters",
        { params: { limit: limit ?? null } },
      ),
  });
}

export function useRequeueConversationDeadLetter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      snapshotId,
    }: {
      groupId: string;
      snapshotId: string;
    }) =>
      apiFetch<ConversationDeadLetterRequeueResponse>(
        `/api/komari-memory/v1/conversation-dead-letters/${encodeURIComponent(groupId)}/${encodeURIComponent(snapshotId)}/requeue`,
        { method: "POST" },
      ),
    onSuccess: () => {
      observePromise(
        queryClient.invalidateQueries({
          queryKey: ["conversation-dead-letters", "list"],
        }),
      );
    },
  });
}
