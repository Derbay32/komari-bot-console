import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
      apiFetch<HelpListResponse>("/api/komari-help/v1/help", {
        params: params as Record<string, string | number | null>,
      }),
  });
}

export function useHelp(hid: number | undefined) {
  return useQuery({
    queryKey: ["help", "detail", hid],
    queryFn: () => apiFetch<HelpEntry>(`/api/komari-help/v1/help/${hid}`),
    enabled: hid !== undefined,
  });
}

export function useCreateHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: HelpCreateRequest) =>
      apiFetch<HelpEntry>("/api/komari-help/v1/help", {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help", "list"] });
    },
  });
}

export function useUpdateHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ hid, data }: { hid: number; data: HelpUpdateRequest }) =>
      apiFetch<HelpEntry>(`/api/komari-help/v1/help/${hid}`, {
        method: "PATCH",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help", "list"] });
      queryClient.invalidateQueries({ queryKey: ["help", "detail"] });
    },
  });
}

export function useDeleteHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hid: number) =>
      apiFetch<null>(`/api/komari-help/v1/help/${hid}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help", "list"] });
      queryClient.invalidateQueries({ queryKey: ["help", "detail"] });
    },
  });
}

export function useSearchHelp() {
  return useMutation({
    mutationFn: (data: HelpSearchRequest) =>
      apiFetch<HelpSearchResult[]>("/api/komari-help/v1/search", {
        method: "POST",
        body: data,
      }),
  });
}

export function useScanHelp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<HelpScanResponse>("/api/komari-help/v1/scan", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help", "list"] });
    },
  });
}
