import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PublicUser } from "@shared/schema";

export const authKey = ["auth", "me"] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: authKey,
    queryFn: async () => {
      try {
        const data = await api.get<{ user: PublicUser }>("/api/auth/me");
        return data.user;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api.post<{ user: PublicUser }>("/api/auth/login", input),
    onSuccess: (data) => {
      qc.setQueryData(authKey, data.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/api/auth/logout"),
    onSuccess: () => {
      qc.setQueryData(authKey, null);
      qc.clear();
    },
  });
}
