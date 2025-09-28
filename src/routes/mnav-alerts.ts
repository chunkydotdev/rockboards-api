import { type Request, type Response, Router } from "express";
import { handleDbError, supabaseServiceRole } from "../lib/supabase";
import type {
	ApiResponse,
	CreateMnavAlertRequest,
	MnavAlertResponse,
	MnavThresholdAlert,
	UpdateMnavAlertRequest,
} from "../types";

const router: Router = Router();

// Helper function to get authenticated user from request
async function getAuthenticatedUser(req: Request) {
	try {
		const authHeader = req.headers.authorization;
		if (!authHeader?.startsWith("Bearer ")) {
			return null;
		}

		const token = authHeader.substring(7);
		const {
			data: { user },
			error,
		} = await supabaseServiceRole.auth.getUser(token);

		if (error || !user) {
			return null;
		}

		return { user };
	} catch (error) {
		console.error("Authentication check error:", error);
		return null;
	}
}

// Helper function to check pro subscription
async function checkProSubscription(userId: string): Promise<boolean> {
	try {
		const { data: profile } = await supabaseServiceRole
			.from("user_profiles")
			.select("subscription_status")
			.eq("id", userId)
			.single();

		return profile?.subscription_status === "pro";
	} catch (error) {
		console.error("Pro subscription check error:", error);
		return false;
	}
}

// Type guard for CreateMnavAlertRequest
function validateCreateAlertRequest(
	body: unknown,
): body is CreateMnavAlertRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { company_id, threshold_value, alert_type } = request;

	return (
		typeof company_id === "string" &&
		company_id.length > 0 &&
		typeof threshold_value === "number" &&
		threshold_value >= 0 &&
		threshold_value <= 5 &&
		(alert_type === "above" || alert_type === "below")
	);
}

// Type guard for UpdateMnavAlertRequest
function validateUpdateAlertRequest(
	body: unknown,
): body is UpdateMnavAlertRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { threshold_value, alert_type, is_active } = request;

	// At least one field must be provided
	if (
		threshold_value === undefined &&
		alert_type === undefined &&
		is_active === undefined
	) {
		return false;
	}

	// Validate threshold_value if provided
	if (
		threshold_value !== undefined &&
		(typeof threshold_value !== "number" ||
			threshold_value < 0 ||
			threshold_value > 5)
	) {
		return false;
	}

	// Validate alert_type if provided
	if (
		alert_type !== undefined &&
		alert_type !== "above" &&
		alert_type !== "below"
	) {
		return false;
	}

	// Validate is_active if provided
	if (is_active !== undefined && typeof is_active !== "boolean") {
		return false;
	}

	return true;
}

// GET /api/mnav-alerts - List user's alerts
router.get("/", async (req: Request, res: Response) => {
	try {
		// Require authentication
		const userResult = await getAuthenticatedUser(req);
		if (!userResult) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const { user } = userResult;

		// Check pro subscription
		const hasPro = await checkProSubscription(user.id);
		if (!hasPro) {
			return res.status(403).json({ error: "Pro subscription required" });
		}

		const limit = Math.min(
			Number.parseInt(req.query.limit as string) || 50,
			100,
		);
		const offset = Math.max(
			Number.parseInt(req.query.offset as string) || 0,
			0,
		);

		const { data: alerts, error } = await supabaseServiceRole
			.from("mnav_threshold_alerts")
			.select(`
				*,
				companies!inner(
					id,
					name,
					ticker
				)
			`)
			.eq("user_id", user.id)
			.order("created_at", { ascending: false })
			.range(offset, offset + limit - 1);

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		const { count } = await supabaseServiceRole
			.from("mnav_threshold_alerts")
			.select("*", { count: "exact", head: true })
			.eq("user_id", user.id);

		const response: ApiResponse<MnavAlertResponse> = {
			data: {
				alerts: alerts || [],
				total: count || 0,
				limit,
				offset,
			},
		};

		res.json(response);
	} catch (error) {
		console.error("GET /mnav-alerts error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/mnav-alerts - Create new alert
router.post("/", async (req: Request, res: Response) => {
	try {
		// Require authentication
		const userResult = await getAuthenticatedUser(req);
		if (!userResult) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const { user } = userResult;

		// Check pro subscription
		const hasPro = await checkProSubscription(user.id);
		if (!hasPro) {
			return res.status(403).json({ error: "Pro subscription required" });
		}

		// Validate request body
		if (!validateCreateAlertRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: company_id (string), threshold_value (0-5), alert_type ('above' | 'below')",
			});
		}

		const { company_id, threshold_value, alert_type } = req.body;

		// Check if user has reached max alerts (5 per company)
		const { count } = await supabaseServiceRole
			.from("mnav_threshold_alerts")
			.select("*", { count: "exact", head: true })
			.eq("user_id", user.id)
			.eq("company_id", company_id)
			.eq("is_active", true);

		if ((count || 0) >= 5) {
			return res
				.status(400)
				.json({ error: "Maximum 5 active alerts per company allowed" });
		}

		// Create the alert
		const { data: alert, error } = await supabaseServiceRole
			.from("mnav_threshold_alerts")
			.insert({
				user_id: user.id,
				company_id,
				threshold_value,
				alert_type,
			})
			.select(`
				*,
				companies!inner(
					id,
					name,
					ticker
				)
			`)
			.single();

		if (error) {
			if (error.code === "23505") {
				// Unique constraint violation
				return res
					.status(400)
					.json({ error: "Alert with this threshold and type already exists" });
			}
			return res.status(500).json(handleDbError(error));
		}

		const response: ApiResponse<MnavThresholdAlert> = {
			data: alert,
		};

		res.status(201).json(response);
	} catch (error) {
		console.error("POST /mnav-alerts error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// PATCH /api/mnav-alerts/:id - Update alert
router.patch("/:id", async (req: Request, res: Response) => {
	try {
		// Require authentication
		const userResult = await getAuthenticatedUser(req);
		if (!userResult) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const { user } = userResult;

		// Check pro subscription
		const hasPro = await checkProSubscription(user.id);
		if (!hasPro) {
			return res.status(403).json({ error: "Pro subscription required" });
		}

		// Validate request body
		if (!validateUpdateAlertRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Optional: threshold_value (0-5), alert_type ('above' | 'below'), is_active (boolean). At least one field required.",
			});
		}

		const { threshold_value, alert_type, is_active } = req.body;

		// Build update object
		const updateData: Partial<UpdateMnavAlertRequest> = {};
		if (threshold_value !== undefined)
			updateData.threshold_value = threshold_value;
		if (alert_type !== undefined) updateData.alert_type = alert_type;
		if (is_active !== undefined) updateData.is_active = is_active;

		// Update the alert
		const { data: alert, error } = await supabaseServiceRole
			.from("mnav_threshold_alerts")
			.update(updateData)
			.eq("id", req.params.id)
			.eq("user_id", user.id)
			.select(`
				*,
				companies!inner(
					id,
					name,
					ticker
				)
			`)
			.single();

		if (error) {
			if (error.code === "23505") {
				// Unique constraint violation
				return res
					.status(400)
					.json({ error: "Alert with this threshold and type already exists" });
			}
			return res.status(500).json(handleDbError(error));
		}

		if (!alert) {
			return res.status(404).json({ error: "Alert not found" });
		}

		const response: ApiResponse<MnavThresholdAlert> = {
			data: alert,
		};

		res.json(response);
	} catch (error) {
		console.error("PATCH /mnav-alerts/:id error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// DELETE /api/mnav-alerts/:id - Delete alert
router.delete("/:id", async (req: Request, res: Response) => {
	try {
		// Require authentication
		const userResult = await getAuthenticatedUser(req);
		if (!userResult) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const { user } = userResult;

		// Check pro subscription
		const hasPro = await checkProSubscription(user.id);
		if (!hasPro) {
			return res.status(403).json({ error: "Pro subscription required" });
		}

		// Delete the alert (using delete().match() to check if any rows were affected)
		const { error, count } = await supabaseServiceRole
			.from("mnav_threshold_alerts")
			.delete({ count: "exact" })
			.eq("id", req.params.id)
			.eq("user_id", user.id);

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		if (count === 0) {
			return res.status(404).json({ error: "Alert not found" });
		}

		const response: ApiResponse<{ success: boolean }> = {
			data: { success: true },
		};

		res.json(response);
	} catch (error) {
		console.error("DELETE /mnav-alerts/:id error:", error);
		res.status(500).json(handleDbError(error));
	}
});

export default router;
