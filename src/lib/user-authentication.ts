import type { Request } from "express";
import { supabase } from "./supabase";

// Helper function to get authenticated user from request
export async function getAuthenticatedUser(req: Request) {
	try {
		const authHeader = req.headers?.authorization;
		if (!authHeader?.startsWith("Bearer ")) {
			return null;
		}

		const token = authHeader.substring(7);
		const {
			data: { user },
			error,
		} = await supabase.auth.getUser(token);

		if (error || !user) {
			return null;
		}

		return { user };
	} catch (error) {
		console.error("Authentication check error:", error);
		return null;
	}
}
