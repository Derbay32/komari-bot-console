import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { observePromise } from "@/lib/async";
import { ApiError, apiFetch, consoleFetch } from "@/lib/http/client";
import type {
  MaintenanceCancelInput,
  MaintenanceCreateInput,
  MaintenanceNotice,
  MaintenanceNoticeSummary,
  MaintenanceUpdateInput,
} from "@/lib/maintenance";
import type { components } from "@/types/komari-api";

type GroupListResponse = components["schemas"]["GroupListResponse"];

type AnnouncementListResponse = {
  notices: MaintenanceNoticeSummary[];
};

type AnnouncementDetailResponse = {
  notice: MaintenanceNotice;
};

type AnnouncementMutationResponse = {
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
      consoleFetch<AnnouncementMutationResponse>("/announcements", {
        body: input,
        headers: { "X-Request-ID": submissionId },
        method: "POST",
      }),
    onSuccess: () => {
      invalidateAnnouncementQueries(queryClient);
    },
  });
}

export function useUpdateAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: MaintenanceUpdateInput;
    }) =>
      consoleFetch<AnnouncementMutationResponse>(
        `/announcements/${encodeURIComponent(id)}`,
        { body: input, method: "PATCH" },
      ),
    onError: (error: Error) => {
      invalidateOnConflict(queryClient, error);
    },
    onSuccess: () => {
      invalidateAnnouncementQueries(queryClient);
    },
  });
}

export function useCancelAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      version,
    }: {
      id: string;
      version: MaintenanceCancelInput["version"];
    }) =>
      consoleFetch<AnnouncementMutationResponse>(
        `/announcements/${encodeURIComponent(id)}/cancel`,
        { body: { version }, method: "POST" },
      ),
    onError: (error: Error) => {
      invalidateOnConflict(queryClient, error);
    },
    onSuccess: () => {
      invalidateAnnouncementQueries(queryClient);
    },
  });
}

type AnnouncementQueryClient = ReturnType<typeof useQueryClient>;

function invalidateAnnouncementQueries(queryClient: AnnouncementQueryClient) {
  observePromise(
    queryClient.invalidateQueries({ queryKey: ["announce", "notices"] }),
  );
  observePromise(
    queryClient.invalidateQueries({ queryKey: ["announce", "notice"] }),
  );
}

/**
 * A rejected version means the displayed state is stale. Refresh list and
 * detail so the next interaction starts from the server's current state.
 */
function invalidateOnConflict(
  queryClient: AnnouncementQueryClient,
  error: Error,
) {
  if (error instanceof ApiError && error.status === 409) {
    invalidateAnnouncementQueries(queryClient);
  }
}

function hasActiveAttempt(data: AnnouncementListResponse | undefined) {
  return data?.notices.some((notice) => notice.activity !== null) ?? false;
}
