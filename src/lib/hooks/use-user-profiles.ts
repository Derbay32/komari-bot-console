import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/http/client";
import type { components } from "@/types/komari-api";

type MemoryEntityEntry = components["schemas"]["MemoryEntityEntry"];
type MemoryEntityListResponse = components["schemas"]["MemoryEntityListResponse"];
const USER_PROFILE_BATCH_SIZE = 100;

type MemoryEntityListParams = {
  group_id?: string | null;
  user_id?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
};

export function useUserProfileList(
  params: MemoryEntityListParams,
  options?: {
    enabled?: boolean;
  },
) {
  return useQuery({
    queryKey: ["user-profiles", "list", params],
    queryFn: () =>
      apiFetch<MemoryEntityListResponse>("/api/komari-memory/v1/user-profiles", {
        params: params as Record<string, string | number | null>,
      }),
    enabled: options?.enabled ?? true,
  });
}

export function useUserProfileGroupSummaryList() {
  return useQuery({
    queryKey: ["user-profiles", "group-summary-list"],
    queryFn: async () => {
      const items = await fetchAllUserProfiles();
      const groupMap = new Map<string, Set<string>>();

      for (const item of items) {
        const groupUsers = groupMap.get(item.group_id) ?? new Set<string>();
        groupUsers.add(item.user_id);
        groupMap.set(item.group_id, groupUsers);
      }

      return Array.from(groupMap.entries())
        .map(([groupId, users]) => ({
          groupId,
          userCount: users.size,
        }))
        .sort((left, right) => {
          if (right.userCount !== left.userCount) {
            return right.userCount - left.userCount;
          }

          return left.groupId.localeCompare(right.groupId, "zh-CN");
        });
    },
  });
}

export function useUserProfile(
  groupId: string | undefined,
  userId: string | undefined,
) {
  return useQuery({
    queryKey: ["user-profiles", "detail", groupId, userId],
    queryFn: () =>
      apiFetch<MemoryEntityEntry>(
        `/api/komari-memory/v1/user-profiles/${groupId}/${userId}`,
      ),
    enabled: !!groupId && !!userId,
  });
}

export function usePutUserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      userId,
      value,
      importance,
    }: {
      groupId: string;
      userId: string;
      value: { [key: string]: unknown };
      importance?: number;
    }) =>
      apiFetch<MemoryEntityEntry>(
        `/api/komari-memory/v1/user-profiles/${groupId}/${userId}`,
        {
          method: "PUT",
          body: value,
          params: importance !== undefined ? { importance } : undefined,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profiles"] });
    },
  });
}

export function useDeleteUserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      userId,
    }: {
      groupId: string;
      userId: string;
    }) =>
      apiFetch<null>(
        `/api/komari-memory/v1/user-profiles/${groupId}/${userId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profiles"] });
    },
  });
}

async function fetchAllUserProfiles(
  params: Omit<MemoryEntityListParams, "limit" | "offset"> = {},
) {
  const items: MemoryEntityEntry[] = [];
  let offset = 0;
  let total = 0;

  do {
    const response = await apiFetch<MemoryEntityListResponse>(
      "/api/komari-memory/v1/user-profiles",
      {
        params: {
          ...params,
          limit: USER_PROFILE_BATCH_SIZE,
          offset,
        } as Record<string, string | number | null>,
      },
    );

    items.push(...response.items);
    total = response.total;
    offset += response.items.length;

    if (!response.items.length) {
      break;
    }
  } while (items.length < total);

  return items;
}
