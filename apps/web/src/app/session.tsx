import type { Permission, SessionView } from "@dbrb/shared";
import { createContext, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../lib/api";
import { browserTimeZone, formatDateTime, timeAgo } from "../lib/format";

export const SESSION_QUERY_KEY = ["session"] as const;

/** Who is signed in, or null. A 401 simply means "nobody". */
export const fetchSession = async (): Promise<SessionView | null> => {
  try {
    return await api.get<SessionView>("/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
};

export const SessionContext = createContext<SessionView | null>(null);

/** The signed-in session. Only for components rendered behind the sign-in guard. */
export const useSession = (): SessionView => {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession used outside a signed-in route");
  return session;
};

export const useOptionalSession = (): SessionView | null => useContext(SessionContext);

/** Whether the current member may do something. The server enforces it; this only shapes the UI. */
export const useCan = (permission: Permission): boolean => useSession().permissions.includes(permission);

/** Date helpers bound to the current user's language and timezone. */
export const useFormat = () => {
  const session = useOptionalSession();
  const { i18n } = useTranslation();
  const timeZone = session?.user.timezone ?? browserTimeZone();
  const locale = i18n.language;
  return useMemo(
    () => ({
      dateTime: (iso: string) => formatDateTime(iso, locale, timeZone),
      ago: (iso: string) => timeAgo(iso, locale),
    }),
    [locale, timeZone],
  );
};
