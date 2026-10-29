import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  CONSOLE_SESSION_COOKIE_NAME,
  getConsoleSession,
} from "@/lib/server/auth";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(CONSOLE_SESSION_COOKIE_NAME)?.value ?? null;
  const session = await getConsoleSession(
    token ? `${CONSOLE_SESSION_COOKIE_NAME}=${token}` : null,
  );

  if (!session) {
    redirect("/login");
  }

  return <AppShell>{children}</AppShell>;
}
