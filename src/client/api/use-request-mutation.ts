import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";

// Forms can run multi-step operations (including passkey ceremonies) as one mutation.
export function useRequestMutation() {
  const mutation = useMutation({ mutationFn: (request: () => Promise<unknown>) => request() });
  const run = useCallback(
    async <T>(request: () => Promise<T>): Promise<T> => (await mutation.mutateAsync(request)) as T,
    [mutation.mutateAsync],
  );
  return { ...mutation, run };
}
