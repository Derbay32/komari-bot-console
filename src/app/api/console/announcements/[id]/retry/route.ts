import {
  getAnnouncementRetryPreview,
  retryAnnouncement,
} from "@/lib/server/maintenance/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return getAnnouncementRetryPreview(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return retryAnnouncement(request, context);
}
