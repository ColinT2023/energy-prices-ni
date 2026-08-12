import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// createClient() throws immediately if either value is missing, which
// would crash `next build` itself (and every page load) before a
// .env.local exists. Left null in that case so callers can show a clear
// "not configured" state instead — see useNiPrices.js.
export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
