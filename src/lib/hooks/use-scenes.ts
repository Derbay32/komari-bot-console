import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { observePromise } from "@/lib/async";
import { apiFetch } from "@/lib/http/client";
import { buildAuditHeaders } from "@/lib/http/audit";
import type { components } from "@/types/komari-api";

type SceneListResponse = components["schemas"]["SceneListResponse"];
type SceneDetail = components["schemas"]["SceneDetail"];
type ScenePatchRequest = components["schemas"]["ScenePatchRequest"];
type SceneSyncResponse = components["schemas"]["SceneSyncResponse"];

export function useSceneList() {
  return useQuery({
    queryKey: ["scenes", "list"],
    queryFn: () =>
      apiFetch<SceneListResponse>("/api/komari-decision-scenes/v1/scenes"),
  });
}

export function useSceneDetail(sceneKey: string | undefined) {
  return useQuery({
    queryKey: ["scenes", "detail", sceneKey],
    queryFn: () =>
      apiFetch<SceneDetail>(
        `/api/komari-decision-scenes/v1/scenes/${encodeURIComponent(sceneKey ?? "")}`,
      ),
    enabled: sceneKey !== undefined,
  });
}

export function usePatchScene() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sceneKey,
      data,
      auditReason,
    }: {
      sceneKey: string;
      data: ScenePatchRequest;
      auditReason: string;
    }) =>
      apiFetch<SceneDetail>(
        `/api/komari-decision-scenes/v1/scenes/${encodeURIComponent(sceneKey)}`,
        {
          method: "PATCH",
          headers: buildAuditHeaders(auditReason),
          body: data,
        },
      ),
    onSuccess: () => {
      observePromise(queryClient.invalidateQueries({ queryKey: ["scenes"] }));
    },
  });
}

export function useSyncScenes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ auditReason }: { auditReason: string }) =>
      apiFetch<SceneSyncResponse>("/api/komari-decision-scenes/v1/sync", {
        method: "POST",
        headers: buildAuditHeaders(auditReason),
      }),
    onSuccess: () => {
      observePromise(queryClient.invalidateQueries({ queryKey: ["scenes"] }));
    },
  });
}
