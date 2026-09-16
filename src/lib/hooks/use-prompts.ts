import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { observePromise } from "@/lib/async";
import { buildAuditHeaders, createRequestId } from "@/lib/http/audit";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type PromptResourceDetail = components["schemas"]["PromptResourceDetail"];
type PromptResourceListResponse = components["schemas"]["PromptResourceListResponse"];
type PromptFieldUpdateRequest = components["schemas"]["PromptFieldUpdateRequest"];

export function usePromptResources() {
  return useQuery({
    queryKey: ["prompt", "resources"],
    queryFn: () =>
      apiFetch<PromptResourceListResponse>("/api/komari-management-prompt/v1/resources"),
  });
}

export function usePromptDetail(resourceId: string | null) {
  return useQuery({
    queryKey: ["prompt", "detail", resourceId],
    queryFn: () =>
      apiFetch<PromptResourceDetail>(
        `/api/komari-management-prompt/v1/resources/${resourceId}`,
      ),
    enabled: !!resourceId,
  });
}

export function useUpdatePromptField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      resourceId,
      fieldName,
      auditReason,
      data,
    }: {
      resourceId: string;
      fieldName: string;
      auditReason: string;
      data: PromptFieldUpdateRequest;
    }) =>
      apiFetch<PromptResourceDetail>(
        `/api/komari-management-prompt/v1/resources/${resourceId}/fields/${fieldName}`,
        {
          method: "PATCH",
          body: data,
          headers: buildAuditHeaders(
            auditReason,
            createRequestId("web-prompt"),
          ),
        },
      ),
    onSuccess: (_, variables) => {
      observePromise(queryClient.invalidateQueries({ queryKey: ["prompt", "detail", variables.resourceId] }));
      observePromise(queryClient.invalidateQueries({ queryKey: ["prompt", "resources"] }));
    },
  });
}
