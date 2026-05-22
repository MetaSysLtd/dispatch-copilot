import { Route, Switch, Redirect, useLocation } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { useCurrentUser } from "@/hooks/useAuth";
import LoginPage from "@/pages/login";
import CarriersListPage from "@/pages/carriers/index";
import CarrierDetailPage from "@/pages/carriers/[id]";
import LoadHunterPage from "@/pages/load-hunter/index";

function ProtectedRoutes() {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    if (location !== "/login") setLocation("/login");
    return null;
  }

  return (
    <Shell>
      <Switch>
        <Route path="/carriers" component={CarriersListPage} />
        <Route path="/carriers/:id">
          {(params) => <CarrierDetailPage id={params.id} />}
        </Route>
        <Route path="/load-hunter" component={LoadHunterPage} />
        <Route>
          <Redirect to="/carriers" />
        </Route>
      </Switch>
    </Shell>
  );
}

export default function App() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route>
        <ProtectedRoutes />
      </Route>
    </Switch>
  );
}
