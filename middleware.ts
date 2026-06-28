import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Runs on every protected route. Two jobs:
//   1. Refresh the Supabase auth cookie so the session stays alive across requests.
//   2. Gate /admin and /tech by role, and bounce logged-in users off /login.
//
// RLS is the real security boundary; this is for UX + cheap early redirects.
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const { data: userResult } = await supabase.auth.getUser();
  const user = userResult.user;
  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const isTech = path === "/tech" || path.startsWith("/tech/");

  if (!user) {
    if (isAdmin || isTech) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", path);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Authenticated — look up role.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: "admin" | "technician" }>();

  const role = profile?.role;

  if (isLogin) {
    return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/tech", request.url));
  }

  if (isAdmin && role !== "admin") {
    return NextResponse.redirect(new URL("/tech", request.url));
  }
  if (isTech && role !== "technician") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

export const config = {
  // Exclude API routes (auth handled separately), static assets, and image opt.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|webmanifest)$).*)"]
};
