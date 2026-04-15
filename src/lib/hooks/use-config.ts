import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type ConfigResourceDetail = components["schemas"]["ConfigResourceDetail"];
type ConfigResourceListResponse = components["schemas"]["ConfigResourceListResponse"];
type ConfigFieldUpdateRequest = components["schemas"]["ConfigFieldUpdateRequest"];

export function useConfigResources() {
  return useQuery({
    queryKey: ["config", "resources"],
    queryFn: () =>
      apiFetch<ConfigResourceListResponse>("/api/komari-management-config/v1/resources"),
  });
}

export function useConfigDetail(resourceId: string | null) {
  return useQuery({
    queryKey: ["config", "detail", resourceId],
    queryFn: () =>
      apiFetch<ConfigResourceDetail>(
        `/api/komari-management-config/v1/resources/${resourceId}`,
      ),
    enabled: !!resourceId,
  });
}

export function useUpdateConfigField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      resourceId,
      fieldName,
      data,
    }: {
      resourceId: string;
      fieldName: string;
      data: ConfigFieldUpdateRequest;
    }) =>
      apiFetch<ConfigResourceDetail>(
        `/api/komari-management-config/v1/resources/${resourceId}/fields/${fieldName}`,
        {
          method: "PATCH",
          body: data,
        },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["config", "detail", variables.resourceId] });
      queryClient.invalidateQueries({ queryKey: ["config", "resources"] });
    },
  });
}

export function useReloadConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (resourceId: string) =>
      apiFetch<ConfigResourceDetail>(
        `/api/komari-management-config/v1/resources/${resourceId}/reload`,
        {
          method: "POST",
        },
      ),
    onSuccess: (_, resourceId) => {
      queryClient.invalidateQueries({ queryKey: ["config", "detail", resourceId] });
      queryClient.invalidateQueries({ queryKey: ["config", "resources"] });
    },
  });
}
