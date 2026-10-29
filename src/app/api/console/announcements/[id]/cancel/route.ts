import { cancelAnnouncement } from "@/lib/server/maintenance/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return cancelAnnouncement(request, context);
}
