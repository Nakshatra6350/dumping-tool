import type { SessionView } from "@dbrb/shared";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { ActivityPage, PlatformActivityPage } from "../features/activity/ActivityPage";
import { LoginPage } from "../features/auth/LoginPage";
import { SignupPage } from "../features/auth/SignupPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { PlatformStoragePage } from "../features/platform/PlatformStoragePage";
import { ProfilePage } from "../features/settings/ProfilePage";
import { AppLayout } from "../features/shell/AppLayout";
import { NotFound, RouteError } from "../features/shell/StateScreens";
import { StoragePage } from "../features/storage/StoragePage";

interface RouterContext {
  session: SessionView | null;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: () => <Outlet /> });

/** Sign-in pages are only for people who are not signed in yet. */
const guestOnly = ({ context }: { context: RouterContext }) => {
  if (context.session) throw redirect({ to: "/" });
};

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: guestOnly,
  component: LoginPage,
});
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  beforeLoad: guestOnly,
  component: SignupPage,
});

/** Everything inside the app shell needs a session. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: AppLayout,
});

const overviewRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: OverviewPage });
const activityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activity",
  component: ActivityPage,
});
const storageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/storage",
  component: StoragePage,
});
const profileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/profile",
  component: ProfilePage,
});

/** The platform console is only for the platform owner. The API enforces this too. */
const platformRoute = createRoute({
  getParentRoute: () => appRoute,
  id: "platform",
  beforeLoad: ({ context }) => {
    if (!context.session?.user.isPlatformAdmin) throw redirect({ to: "/" });
  },
  component: () => <Outlet />,
});
const platformStorageRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "/platform/storage",
  component: PlatformStoragePage,
});
const platformActivityRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "/platform/activity",
  component: PlatformActivityPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  appRoute.addChildren([
    overviewRoute,
    activityRoute,
    storageRoute,
    profileRoute,
    platformRoute.addChildren([platformStorageRoute, platformActivityRoute]),
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { session: null },
  defaultPreload: false,
  scrollRestoration: true,
  // A page that fails to render, or an address that leads nowhere, gets a proper screen.
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
