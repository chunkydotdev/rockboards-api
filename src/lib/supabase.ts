import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl =
	process.env.SUPABASE_URL || "https://jhyjxnysgrubzwmhownx.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
	throw new Error("Missing Supabase anon key");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Service role client for server-side operations that bypass RLS
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
	console.warn(
		"SUPABASE_SERVICE_ROLE_KEY not found, service role client may not work properly",
	);
}

export const supabaseServiceRole = createClient(
	supabaseUrl,
	serviceRoleKey || supabaseKey, // Fallback to anon key if service key not available
	{
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	},
);

// Helper function to handle database errors
export function handleDbError(error: unknown) {
	console.error("Database error:", error);
	return {
		error: error instanceof Error ? error.message : "Database operation failed",
	};
}
