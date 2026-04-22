import { useMutation, useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type GroupListResponse = components["schemas"]["GroupListResponse"];
type MaintenanceAnnounceRequest = components["schemas"]["MaintenanceAnnounceRequest"];
type MaintenanceAnnounceResponse = components["schemas"]["MaintenanceAnnounceResponse"];

export function useGroupList() {
  return useQuery({
    queryKey: ["announce", "groups"],
    queryFn: () => apiFetch<GroupListResponse>("/api/komari-announce/v1/groups"),
  });
}

export function useSendMaintenanceAnnounce() {
  return useMutation({
    mutationFn: (data: MaintenanceAnnounceRequest) =>
      apiFetch<MaintenanceAnnounceResponse>("/api/komari-announce/v1/maintenance", {
        method: "POST",
        body: data,
      }),
  });
}
