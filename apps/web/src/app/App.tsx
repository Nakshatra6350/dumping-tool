import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppIcon } from "../components/Logo";
import { ToastViewport } from "../components/ui";
import { ServerUnreachable } from "../features/shell/StateScreens";
import { ApiError, setUnauthorizedHandler } from "../lib/api";
import i18n, { setLanguage } from "../lib/i18n";
import { toast } from "../lib/toast";
import { router } from "./router";
import { SESSION_QUERY_KEY, SessionContext, fetchSession } from "./session";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Don't retry what will fail again: missing permission, validation, not found.
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

// If any request finds the session gone, drop it; the router then shows the sign-in page.
setUnauthorizedHandler(() => {
  if (queryClient.getQueryData(SESSION_QUERY_KEY)) {
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
    toast({ type: "info", title: i18n.t("errors.session_expired") });
  }
});

/** Finds out who is signed in, then hands over to the router. */
const Session = () => {
  const {
    data: session,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: Infinity,
  });

  // The signed-in user's saved language wins over the device's.
  useEffect(() => {
    if (session) setLanguage(session.user.locale);
  }, [session?.user.locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run the route guards whenever someone signs in or out. Not while the
  // server is unreachable: "nobody is signed in" would be a guess, and acting on
  // it would send a signed-in person away from the page they asked for.
  useEffect(() => {
    if (!isPending && !isError) void router.invalidate();
  }, [session, isPending, isError]);

  if (isPending) {
    return (
      <div className="boot">
        <div className="boot-pulse">
          <AppIcon size={48} />
        </div>
      </div>
    );
  }

  // The server did not answer. Sending someone who is signed in to the sign-in page would be wrong.
  if (isError) return <ServerUnreachable onRetry={() => void refetch()} retrying={isFetching} />;

  return (
    <SessionContext value={session ?? null}>
      <RouterProvider router={router} context={{ session: session ?? null }} />
    </SessionContext>
  );
};

export const App = () => (
  <QueryClientProvider client={queryClient}>
    <Session />
    <ToastViewport />
  </QueryClientProvider>
);
