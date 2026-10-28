export const capturedQueries = [];
export const capturedMutations = [];

let queryClient = null;

export function configureQueryClient(client) {
  queryClient = client;
}

export function resetCapturedHooks() {
  capturedQueries.length = 0;
  capturedMutations.length = 0;
}

export function useQuery(options) {
  capturedQueries.push(options);
  return { data: undefined, isPending: true };
}

export function useMutation(options) {
  capturedMutations.push(options);
  return { mutateAsync: options.mutationFn, isPending: false };
}

export function useQueryClient() {
  return queryClient;
}
