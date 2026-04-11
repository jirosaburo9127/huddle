import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 から middleware は proxy 規約に改名された。
// 機能は同じで、呼び出し規約だけ変わる。
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|offline\\.html|icons/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
