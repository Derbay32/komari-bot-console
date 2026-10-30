import {
  createAnnouncement,
  listAnnouncements,
} from "@/lib/server/maintenance/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return listAnnouncements(request);
}

export async function POST(request: Request) {
  return createAnnouncement(request);
}
