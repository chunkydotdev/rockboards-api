import { type Request, type Response, Router } from "express";
import { handleDbError, supabaseServiceRole } from "../lib/supabase";
import { calculateCurrentMnav } from "../services/mnav-service";
import type { ApiResponse } from "../types";

// Database types
interface ActiveAlert {
	id: string;
	user_id: string;
	company_id: string;
	threshold_value: number;
	alert_type: string;
	is_active: boolean;
	last_triggered_at: string | null;
	created_at: string;
	updated_at: string;
	company_ticker: string;
	company_name: string;
	user_email: string;
	recent_trigger_count: number;
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

// Note: MNAV calculation logic moved to mnav-service.ts

// Check all active alerts and trigger notifications
async function checkMnavThresholds(): Promise<{
	alertsChecked: number;
	alertsTriggered: number;
	notificationsCreated: string[];
}> {
	try {
		// Get all active alerts
		const { data: alerts, error: alertsError } = await supabaseServiceRole
			.from("active_mnav_alerts")
			.select("*");

		if (alertsError) {
			throw alertsError;
		}

		if (!alerts || alerts.length === 0) {
			return { alertsChecked: 0, alertsTriggered: 0, notificationsCreated: [] };
		}

		console.log(`Checking ${alerts.length} active alerts`);

		// Type the alerts properly
		const typedAlerts = alerts as ActiveAlert[];

		// Group alerts by company to avoid redundant calculations
		const alertsByCompany = typedAlerts.reduce(
			(acc, alert) => {
				const companyId = alert.company_id;
				if (!acc[companyId]) {
					acc[companyId] = [];
				}
				acc[companyId].push(alert);
				return acc;
			},
			{} as Record<string, ActiveAlert[]>,
		);

		let alertsTriggered = 0;
		const notificationsCreated: string[] = [];

		// Check each company's alerts
		for (const [companyId, companyAlerts] of Object.entries(alertsByCompany)) {
			const currentMnav = await calculateCurrentMnav(companyId);

			if (currentMnav === null) {
				console.warn(
					`Could not calculate MNAV for company ${companyId}, skipping alerts`,
				);
				continue;
			}

			// Check each alert for this company
			for (const alert of companyAlerts) {
				const shouldTrigger = checkAlertCondition(
					currentMnav,
					alert.threshold_value,
					alert.alert_type,
				);
				const cooldownPassed = checkCooldownPeriod(alert.last_triggered_at);

				if (shouldTrigger && cooldownPassed) {
					console.log(
						`Triggering alert ${alert.id} - MNAV ${currentMnav} ${alert.alert_type} ${alert.threshold_value}`,
					);

					// Create notification record
					const { data: notification, error: notificationError } =
						await supabaseServiceRole
							.from("mnav_notifications")
							.insert({
								alert_id: alert.id,
								user_id: alert.user_id,
								company_id: alert.company_id,
								mnav_value: currentMnav,
								threshold_value: alert.threshold_value,
								alert_type: alert.alert_type,
								email_sent: false,
								telegram_sent: false,
								whatsapp_sent: false,
								delivery_attempts: {},
							})
							.select("id")
							.single();

					if (notificationError) {
						console.error("Error creating notification:", notificationError);
						continue;
					}

					// Update alert's last_triggered_at
					await supabaseServiceRole
						.from("mnav_threshold_alerts")
						.update({ last_triggered_at: new Date().toISOString() })
						.eq("id", alert.id);

					alertsTriggered++;
					notificationsCreated.push(notification.id);
				}
			}
		}

		return {
			alertsChecked: alerts.length,
			alertsTriggered,
			notificationsCreated,
		};
	} catch (error) {
		console.error("Error checking MNAV thresholds:", error);
		throw error;
	}
}

// Helper function to check if alert condition is met
function checkAlertCondition(
	currentMnav: number,
	threshold: number,
	alertType: string,
): boolean {
	if (alertType === "above") {
		return currentMnav > threshold;
	}
	if (alertType === "below") {
		return currentMnav < threshold;
	}
	return false;
}

// Helper function to check if cooldown period has passed (6 hours)
function checkCooldownPeriod(lastTriggered: string | null): boolean {
	if (!lastTriggered) return true;

	const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
	const lastTriggeredDate = new Date(lastTriggered);

	return lastTriggeredDate < sixHoursAgo;
}

// POST /api/mnav-monitor/check - Check MNAV thresholds and create notifications
router.post("/check", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult.status || 401)
				.json({ error: authResult.error });
		}

		console.log("Starting MNAV threshold check...");

		const results = await checkMnavThresholds();

		const response: ApiResponse<typeof results> = {
			data: results,
			message: `Checked ${results.alertsChecked} alerts, triggered ${results.alertsTriggered} notifications`,
		};

		console.log("MNAV check completed:", response.message);
		res.json(response);
	} catch (error) {
		console.error("MNAV monitor check error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/mnav-monitor/status - Get monitoring service status
router.get("/status", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult.status || 401)
				.json({ error: authResult.error });
		}

		// Get counts from database
		const [activeAlerts, recentNotifications] = await Promise.all([
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
		]);

		const response: ApiResponse<{
			status: string;
			activeAlerts: number;
			recentNotifications: number;
			lastCheck: string;
		}> = {
			data: {
				status: "operational",
				activeAlerts: activeAlerts.count || 0,
				recentNotifications: recentNotifications.count || 0,
				lastCheck: new Date().toISOString(),
			},
		};

		res.json(response);
	} catch (error) {
		console.error("MNAV monitor status error:", error);
		res.status(500).json(handleDbError(error));
	}
});

export default router;
