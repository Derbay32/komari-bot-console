import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { observePromise } from "@/lib/async";
import { ApiError, apiFetch, consoleFetch } from "@/lib/http/client";
import type {
  MaintenanceCancelInput,
  MaintenanceCreateInput,
  MaintenanceNotice,
  MaintenanceNoticeSummary,
  MaintenanceRetryPreview,
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

type RetryPreviewResponse = {
  preview: MaintenanceRetryPreview;
};

type RetryAnnouncementResponse = {
  notice: MaintenanceNoticeSummary;
  attemptId: string;
  created: boolean;
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

/**
 * Poll every open detail so a notice cleaned up by the worker becomes a
 * known 404 without waiting for the user to reopen it. A 404 stops polling
 * and refreshes the list; other failures keep the project retry policy.
 */
export function useAnnouncementDetail(id: string | null) {
  const queryClient = useQueryClient();

  return useQuery({
    enabled: Boolean(id),
    queryKey: ["announce", "notice", id],
    queryFn: async () => {
      try {
        return await consoleFetch<AnnouncementDetailResponse>(
          `/announcements/${encodeURIComponent(id ?? "")}`,
        );
      } catch (error) {
        if (isNotFoundError(error)) {
          observePromise(
            queryClient.invalidateQueries({
              queryKey: ["announce", "notices"],
            }),
          );
        }

        throw error;
      }
    },
    refetchInterval: (query) => {
      if (!id || isNotFoundError(query.state.error)) {
        return false;
      }

      return ACTIVE_ATTEMPT_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    retry: (failureCount, error) =>
      isNotFoundError(error) ? false : failureCount < 1,
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

/**
 * Load one retry preview. Callers pass a fresh token per confirmation session
 * so the preview never changes underneath an already-confirmed payload.
 */
export function useRetryAnnouncementPreview(
  noticeId: string,
  previewToken: string,
) {
  return useQuery({
    queryKey: ["announce", "retry-preview", noticeId, previewToken],
    queryFn: () =>
      consoleFetch<RetryPreviewResponse>(
        `/announcements/${encodeURIComponent(noticeId)}/retry`,
      ),
    gcTime: 0,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRetryAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      noticeId,
      version,
      groupIds,
      submissionId,
    }: {
      noticeId: string;
      version: number;
      groupIds: number[];
      submissionId: string;
    }) =>
      consoleFetch<RetryAnnouncementResponse>(
        `/announcements/${encodeURIComponent(noticeId)}/retry`,
        {
          body: { groupIds, version },
          headers: { "X-Request-ID": submissionId },
          method: "POST",
        },
      ),
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

function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}
