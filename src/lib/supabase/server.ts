/**
 * 서버(Server Component·Server Action·Route Handler)용 Supabase 클라이언트.
 * 세션은 HttpOnly 쿠키로만 다루고, 브라우저용 클라이언트는 만들지 않는다.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfigFromEnv } from "./config";

export async function createSupabaseServerClient() {
  const config = supabaseConfigFromEnv();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Component 렌더 중에는 쿠키를 쓸 수 없다. 세션 갱신은 proxy가 맡는다.
        }
      },
    },
  });
}
