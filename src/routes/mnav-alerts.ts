import { type Request, type Response, Router } from "express";
import { handleDbError, supabaseServiceRole } from "../lib/supabase";
import type { ApiResponse } from "../types";

// Database response types
interface NotificationWithRelations {
	id: string;
	mnav_value: number;
	threshold_value: number;
	alert_type: string;
	created_at: string;
	user_profiles: {
		id: string;
		email: string;
	} | null;
	companies: {
		name: string;
		ticker: string;
	} | null;
}

const router: Router = Router();

// Helper function to check cron authentication (copied from polls.ts)
function requireCronAuth(req: Request) {
	const authHeader = req.headers.authorization;
	const cronSecret = process.env.CRON_SECRET;
	const isCronJob = authHeader === `Bearer ${cronSecret}` && cronSecret;

	if (!isCronJob) {
		return { error: "Authentication required", status: 401 as const };
	}

	return { authenticated: true as const };
}

interface TriggeredAlert {
	notification_id: string;
	user_email: string;
	user_id: string;
	company_name: string;
	company_ticker: string;
	threshold_value: number;
	current_mnav: number;
	alert_type: "above" | "below";
	created_at: string;
	telegram_chat_id?: string;
	whatsapp_phone?: string;
	notification_email: boolean;
	notification_telegram: boolean;
	notification_whatsapp: boolean;
}

// GET /api/mnav-alerts/triggered - Get users with triggered alerts that need notifications
router.get("/triggered", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult.status || 401)
				.json({ error: authResult.error });
		}

		// Get notifications that haven't been sent yet with user and company details
		const { data: notifications, error } = await supabaseServiceRole
			.from("mnav_notifications")
			.select(`
				id,
				mnav_value,
				threshold_value,
				alert_type,
				created_at,
				user_profiles!mnav_notifications_user_id_fkey (
					id,
					email
				),
				companies!mnav_notifications_company_id_fkey (
					name,
					ticker
				)
			`)
			.eq("email_sent", false)
			.order("created_at", { ascending: true });

		if (error) {
			throw error;
		}

		// Transform the data for easier consumption by n8n
		const typedNotifications = notifications as unknown as
			| NotificationWithRelations[]
			| null;
		const triggeredAlerts: TriggeredAlert[] = (typedNotifications || []).map(
			(notification) => ({
				notification_id: notification.id,
				user_email: notification.user_profiles?.email || "",
				user_id: notification.user_profiles?.id || "",
				company_name: notification.companies?.name || "",
				company_ticker: notification.companies?.ticker || "",
				threshold_value: notification.threshold_value,
				current_mnav: notification.mnav_value,
				alert_type: notification.alert_type as "above" | "below",
				created_at: notification.created_at,
				telegram_chat_id: undefined, // Not available in current schema
				whatsapp_phone: undefined, // Not available in current schema
				notification_email: true, // Default to true for now
				notification_telegram: false, // Default to false
				notification_whatsapp: false, // Default to false
			}),
		);

		// Filter out alerts for users who don't have email notifications enabled
		const emailAlerts = triggeredAlerts.filter(
			(alert) => alert.notification_email && alert.user_email,
		);

		const response: ApiResponse<{
			alerts: TriggeredAlert[];
			total_notifications: number;
			email_notifications: number;
		}> = {
			data: {
				alerts: emailAlerts,
				total_notifications: triggeredAlerts.length,
				email_notifications: emailAlerts.length,
			},
			message:
				emailAlerts.length > 0
					? `Found ${emailAlerts.length} email notifications to send (${triggeredAlerts.length} total)`
					: "No triggered alerts found - all clear!",
		};

		console.log(`Retrieved ${emailAlerts.length} triggered email alerts`);
		res.json(response);
	} catch (error) {
		console.error("Get triggered alerts error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/mnav-alerts/mark-sent - Mark alerts as sent to prevent duplicate notifications
router.post("/mark-sent", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult.status || 401)
				.json({ error: authResult.error });
		}

		const { notification_ids, channel_type = "email" } = req.body;

		if (
			!notification_ids ||
			!Array.isArray(notification_ids) ||
			notification_ids.length === 0
		) {
			return res.status(400).json({
				error: "notification_ids array is required",
			});
		}

		if (!["email", "telegram", "whatsapp"].includes(channel_type)) {
			return res.status(400).json({
				error: "channel_type must be 'email', 'telegram', or 'whatsapp'",
			});
		}

		console.log(
			`Marking ${notification_ids.length} notifications as ${channel_type} sent`,
		);

		// Update the appropriate sent flag based on channel type
		const updateFields: Record<string, unknown> = {};

		if (channel_type === "email") {
			updateFields.email_sent = true;
			updateFields.email_sent_at = new Date().toISOString();
		} else if (channel_type === "telegram") {
			updateFields.telegram_sent = true;
			updateFields.telegram_sent_at = new Date().toISOString();
		} else if (channel_type === "whatsapp") {
			updateFields.whatsapp_sent = true;
			updateFields.whatsapp_sent_at = new Date().toISOString();
		}

		const { data: updatedNotifications, error } = await supabaseServiceRole
			.from("mnav_notifications")
			.update(updateFields)
			.in("id", notification_ids)
			.select("id");

		if (error) {
			throw error;
		}

		// Create delivery log entries for tracking
		const deliveryLogEntries = notification_ids.map(
			(notificationId: string) => ({
				notification_id: notificationId,
				channel_type,
				recipient: "", // Will be filled by n8n if needed
				status: "sent",
				sent_at: new Date().toISOString(),
			}),
		);

		await supabaseServiceRole
			.from("notification_delivery_log")
			.insert(deliveryLogEntries);

		const response: ApiResponse<{
			updated_count: number;
			notification_ids: string[];
			channel_type: string;
		}> = {
			data: {
				updated_count: updatedNotifications?.length || 0,
				notification_ids,
				channel_type,
			},
			message: `Marked ${updatedNotifications?.length || 0} notifications as ${channel_type} sent`,
		};

		console.log(
			`Successfully marked ${updatedNotifications?.length || 0} notifications as ${channel_type} sent`,
		);
		res.json(response);
	} catch (error) {
		console.error("Mark notifications as sent error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/mnav-alerts/mark-failed - Mark alerts as failed with error details
router.post("/mark-failed", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult.status || 401)
				.json({ error: authResult.error });
		}

		const {
			notification_ids,
			channel_type = "email",
			error_message,
		} = req.body;

		if (
			!notification_ids ||
			!Array.isArray(notification_ids) ||
			notification_ids.length === 0
		) {
			return res.status(400).json({
				error: "notification_ids array is required",
			});
		}

		if (!error_message) {
			return res.status(400).json({
				error: "error_message is required",
			});
		}

		console.log(
			`Marking ${notification_ids.length} notifications as ${channel_type} failed:`,
			error_message,
		);

		// Update the last_error field
		const { data: updatedNotifications, error } = await supabaseServiceRole
			.from("mnav_notifications")
			.update({
				last_error: error_message,
				delivery_attempts: supabaseServiceRole.rpc("jsonb_set", {
					target: "delivery_attempts",
					path: `{${channel_type}}`,
					new_value: JSON.stringify({
						attempts: 1,
						last_attempt: new Date().toISOString(),
						error: error_message,
					}),
				}),
			})
			.in("id", notification_ids)
			.select("id");

		if (error) {
			throw error;
		}

		// Create delivery log entries for failed attempts
		const deliveryLogEntries = notification_ids.map(
			(notificationId: string) => ({
				notification_id: notificationId,
				channel_type,
				recipient: "",
				status: "failed",
				error_message,
				sent_at: new Date().toISOString(),
			}),
		);

		await supabaseServiceRole
			.from("notification_delivery_log")
			.insert(deliveryLogEntries);

		const response: ApiResponse<{
			updated_count: number;
			notification_ids: string[];
			channel_type: string;
			error_message: string;
		}> = {
			data: {
				updated_count: updatedNotifications?.length || 0,
				notification_ids,
				channel_type,
				error_message,
			},
			message: `Marked ${updatedNotifications?.length || 0} notifications as ${channel_type} failed`,
		};

		res.json(response);
	} catch (error) {
		console.error("Mark notifications as failed error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/mnav-alerts/stats - Get alert statistics for monitoring
router.get("/stats", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult.status || 401)
				.json({ error: authResult.error });
		}

		// Get various statistics
		const [
			totalActiveAlerts,
			notificationsLast24h,
			emailsSentLast24h,
			pendingNotifications,
		] = await Promise.all([
			supabaseServiceRole
				.from("mnav_threshold_alerts")
				.select("id", { count: "exact" })
				.eq("is_active", true),
			supabaseServiceRole
				.from("mnav_notifications")
				.select("id", { count: "exact" })
				.gte(
					"created_at",
					new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				),
			supabaseServiceRole
				.from("mnav_notifications")
				.select("id", { count: "exact" })
				.eq("email_sent", true)
				.gte(
					"email_sent_at",
					new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				),
			supabaseServiceRole
				.from("mnav_notifications")
				.select("id", { count: "exact" })
				.eq("email_sent", false),
		]);

		const response: ApiResponse<{
			total_active_alerts: number;
			notifications_last_24h: number;
			emails_sent_last_24h: number;
			pending_notifications: number;
			timestamp: string;
		}> = {
			data: {
				total_active_alerts: totalActiveAlerts.count || 0,
				notifications_last_24h: notificationsLast24h.count || 0,
				emails_sent_last_24h: emailsSentLast24h.count || 0,
				pending_notifications: pendingNotifications.count || 0,
				timestamp: new Date().toISOString(),
			},
		};

		res.json(response);
	} catch (error) {
		console.error("Get alert stats error:", error);
		res.status(500).json(handleDbError(error));
	}
});

export default router;
