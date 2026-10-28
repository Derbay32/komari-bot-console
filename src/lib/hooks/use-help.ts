import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { observePromise } from "@/lib/async";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type HelpEntry = components["schemas"]["HelpEntry"];
type HelpListResponse = components["schemas"]["HelpListResponse"];
type HelpCreateRequest = components["schemas"]["HelpCreateRequest"];
type HelpUpdateRequest = components["schemas"]["HelpUpdateRequest"];
type HelpSearchRequest = components["schemas"]["HelpSearchRequest"];
type HelpSearchResult = components["schemas"]["HelpSearchResult"];
type HelpScanResponse = components["schemas"]["HelpScanResponse"];

export type HelpCategory = "command" | "feature" | "faq" | "other";

export type HelpListParams = {
  q?: string | null;
  category?: HelpCategory | null;
  limit?: number;
  offset?: number;
};

export function useHelpList(params: HelpListParams) {
  return useQuery({
    queryKey: ["help", "list", params],
    queryFn: () =>
      apiFetch<HelpListResponse>("/api/v2/komari-help/help", {
        params: params as Record<string, string | number | null>,
      }),
  });
}

export function useHelp(hid: number | undefined) {
  return useQuery({
    queryKey: ["help", "detail", hid],
    queryFn: () => apiFetch<HelpEntry>(`/api/v2/komari-help/help/${hid}`),
    enabled: hid !== undefined,
  });
}

export function useCreateHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: HelpCreateRequest) =>
      apiFetch<HelpEntry>("/api/v2/komari-help/help", {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      observePromise(queryClient.invalidateQueries({ queryKey: ["help", "list"] }));
    },
  });
}

export function useUpdateHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ hid, data }: { hid: number; data: HelpUpdateRequest }) =>
      apiFetch<HelpEntry>(`/api/v2/komari-help/help/${hid}`, {
        method: "PATCH",
        body: data,
      }),
    onSuccess: () => {
      observePromise(queryClient.invalidateQueries({ queryKey: ["help", "list"] }));
      observePromise(queryClient.invalidateQueries({ queryKey: ["help", "detail"] }));
    },
  });
}

export function useDeleteHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hid: number) =>
      apiFetch<null>(`/api/v2/komari-help/help/${hid}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      observePromise(queryClient.invalidateQueries({ queryKey: ["help", "list"] }));
      observePromise(queryClient.invalidateQueries({ queryKey: ["help", "detail"] }));
    },
  });
}

export function useSearchHelp() {
  return useMutation({
    mutationFn: (data: HelpSearchRequest) =>
      apiFetch<HelpSearchResult[]>("/api/v2/komari-help/search", {
        method: "POST",
        body: data,
      }),
  });
}

export function useScanHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<HelpScanResponse>("/api/v2/komari-help/scan", {
        method: "POST",
      }),
    onSuccess: () => {
      observePromise(queryClient.invalidateQueries({ queryKey: ["help", "list"] }));
    },
  });
}
