import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { observePromise } from "@/lib/async";
import { apiFetch, consoleFetch } from "@/lib/http/client";
import type {
  MaintenanceCreateInput,
  MaintenanceNotice,
  MaintenanceNoticeSummary,
} from "@/lib/maintenance";
import type { components } from "@/types/komari-api";

type GroupListResponse = components["schemas"]["GroupListResponse"];

type AnnouncementListResponse = {
  notices: MaintenanceNoticeSummary[];
};

type AnnouncementDetailResponse = {
  notice: MaintenanceNotice;
};

type CreateAnnouncementResponse = {
  notice: MaintenanceNoticeSummary;
};

const ACTIVE_ATTEMPT_POLL_INTERVAL_MS = 2_000;

export function useGroupList() {
  return useQuery({
    queryKey: ["announce", "groups"],
    queryFn: () =>
      apiFetch<GroupListResponse>("/api/v2/komari-announce/groups"),
  });
}

export function useAnnouncementList() {
  return useQuery({
    queryKey: ["announce", "notices"],
    queryFn: () =>
      consoleFetch<AnnouncementListResponse>("/announcements"),
    refetchInterval: (query) =>
      hasActiveAttempt(query.state.data)
        ? ACTIVE_ATTEMPT_POLL_INTERVAL_MS
        : false,
    refetchIntervalInBackground: false,
  });
}

export function useAnnouncementDetail(id: string | null) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ["announce", "notice", id],
    queryFn: () =>
      consoleFetch<AnnouncementDetailResponse>(
        `/announcements/${encodeURIComponent(id ?? "")}`,
      ),
    refetchInterval: (query) =>
      query.state.data?.notice.activity
        ? ACTIVE_ATTEMPT_POLL_INTERVAL_MS
        : false,
    refetchIntervalInBackground: false,
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      input,
      submissionId,
    }: {
      input: MaintenanceCreateInput;
      submissionId: string;
    }) =>
      consoleFetch<CreateAnnouncementResponse>("/announcements", {
        body: input,
        headers: { "X-Request-ID": submissionId },
        method: "POST",
      }),
    onSuccess: () => {
      observePromise(
        queryClient.invalidateQueries({ queryKey: ["announce", "notices"] }),
      );
      observePromise(
        queryClient.invalidateQueries({ queryKey: ["announce", "notice"] }),
      );
    },
  });
}

function hasActiveAttempt(data: AnnouncementListResponse | undefined) {
  return data?.notices.some((notice) => notice.activity !== null) ?? false;
}
