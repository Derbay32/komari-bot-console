import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import { buildAuditHeaders } from "@/lib/http/audit";
import type { components } from "@/types/komari-api";

type BanListResponse = components["schemas"]["BanListResponse"];
type CreateBanRequest = components["schemas"]["CreateBanRequest"];
type BanMutationResponse = components["schemas"]["BanMutationResponse"];

type BanListParams = {
  scope?: ("chat" | "command" | "all") | null;
  page?: number;
  page_size?: number;
};

export function useBanList(params: BanListParams) {
  return useQuery({
    queryKey: ["bans", "list", params],
    queryFn: () =>
      apiFetch<BanListResponse>("/api/komari-user-bans/v1/bans", {
        params: params as Record<string, string | number | null>,
      }),
  });
}

export function useCreateOrUpdateBan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      auditReason,
    }: {
      data: CreateBanRequest;
      auditReason: string;
    }) =>
      apiFetch<BanMutationResponse>("/api/komari-user-bans/v1/bans", {
        method: "POST",
        headers: buildAuditHeaders(auditReason),
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bans", "list"] });
    },
  });
}

export function useDeleteBan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      scope,
      auditReason,
    }: {
      userId: string;
      scope: string;
      auditReason: string;
    }) =>
      apiFetch<BanMutationResponse>(
        `/api/komari-user-bans/v1/bans/${encodeURIComponent(userId)}/${encodeURIComponent(scope)}`,
        {
          method: "DELETE",
          headers: buildAuditHeaders(auditReason),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bans", "list"] });
    },
  });
}
