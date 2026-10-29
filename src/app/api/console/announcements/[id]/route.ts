import { getAnnouncement } from "@/lib/server/maintenance/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return getAnnouncement(request, context);
}
