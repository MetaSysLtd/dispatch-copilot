import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Truck, Users, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCurrentUser, useLogout } from "@/hooks/useAuth";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [{ to: "/carriers", label: "Carriers", icon: Users }];

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: user } = useCurrentUser();
  const logout = useLogout();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-muted/40">
      <aside className="flex w-60 flex-col border-r bg-background">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Truck className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">Dispatch Copilot</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map((item) => {
            const active =
              location === item.to || location.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                href={item.to}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3 text-sm">
          <div className="mb-2 truncate text-muted-foreground">
            {user?.email ?? "—"}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
