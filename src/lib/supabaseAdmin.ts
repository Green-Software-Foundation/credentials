import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./supabase";

let supabaseAdminClient: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  if (supabaseAdminClient) return supabaseAdminClient;

  const serviceRoleKey =
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set; required for server-side writes.");
  }

  const url = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL || supabaseUrl;
  supabaseAdminClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdminClient;
}
