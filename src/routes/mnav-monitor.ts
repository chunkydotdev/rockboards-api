import { type Request, type Response, Router } from "express";
import { handleDbError } from "../lib/supabase";
import { mnavMonitor } from "../services/mnav-monitor";
import { notificationManager } from "../services/notifications/notification-manager";
import type {
	ApiResponse,
	CronCheckForEmailResponse,
	MnavMonitorCheckResponse,
	MonitoringStatusResponse,
	NotificationProvidersResponse,
	TestNotificationRequest,
	TestNotificationResponse,
} from "../types";

const router: Router = Router();

// Helper function to check cron authentication
function requireCronAuth(req: Request) {
	const authHeader = req.headers.authorization;
	const cronSecret = process.env.CRON_SECRET;
	const isCronJob = authHeader === `Bearer ${cronSecret}` && cronSecret;

	if (!isCronJob) {
		return { error: "Authentication required", status: 401 };
	}

	return { authenticated: true };
}

// Type guard for TestNotificationRequest
function validateTestNotificationRequest(
	body: unknown,
): body is TestNotificationRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { userId, channelType } = request;

	if (typeof userId !== "string" || userId.length === 0) {
		return false;
	}

	if (channelType !== undefined && typeof channelType !== "string") {
		return false;
	}

	return true;
}

// POST /api/mnav-monitor/check - Manually trigger MNAV check
router.post("/check", async (req: Request, res: Response) => {
	try {
		console.log("Manual MNAV monitoring check triggered");
		const results = await mnavMonitor.checkAllAlerts();

		const response: ApiResponse<MnavMonitorCheckResponse> = {
			data: {
				success: true,
				message: "MNAV monitoring check completed",
				results: results.map((result) => ({
					company_id: result.company_id,
					current_mnav: result.current_mnav,
					triggered_alerts_count: result.triggered_alerts.length,
					triggered_alerts: result.triggered_alerts.map((alert) => ({
						id: alert.id,
						user_id: alert.user_id,
						threshold_value: alert.threshold_value,
						alert_type: alert.alert_type,
						company_ticker: alert.company_ticker || "",
					})),
				})),
			},
		};

		res.json(response);
	} catch (error) {
		console.error("Error in manual MNAV check:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/mnav-monitor/cron-check - Cron job endpoint for external email service
router.post("/cron-check", async (req: Request, res: Response) => {
	try {
		// Require cron authentication
		const cronAuth = requireCronAuth(req);
		if ("error" in cronAuth) {
			return res.status(cronAuth.status || 401).json({ error: cronAuth.error });
		}

		console.log(
			"MNAV monitoring cron job triggered by external service (for email handling)",
		);
		const emailData = await mnavMonitor.checkAlertsForExternalEmail();

		const response: ApiResponse<CronCheckForEmailResponse> = {
			data: {
				success: true,
				message: "MNAV monitoring check completed for external email service",
				triggered_alerts: emailData.triggered_alerts,
				total_companies_checked: emailData.total_companies_checked,
				total_alerts_triggered: emailData.total_alerts_triggered,
			},
		};

		res.json(response);
	} catch (error) {
		console.error("Error in MNAV cron check for email service:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/mnav-monitor/test-notification - Send test notification
router.post("/test-notification", async (req: Request, res: Response) => {
	try {
		// Validate request body
		if (!validateTestNotificationRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: userId (string). Optional: channelType (string)",
			});
		}

		const { userId, channelType } = req.body;

		const deliveries = await notificationManager.sendTestNotification(
			userId,
			channelType,
		);

		const response: ApiResponse<TestNotificationResponse> = {
			data: {
				success: true,
				message: "Test notification sent",
				deliveries: deliveries.map((d) => ({
					channelType: d.channelType,
					recipient: d.recipient,
					success: d.result.success,
					error: d.result.error,
					messageId: d.result.messageId,
				})),
			},
		};

		res.json(response);
	} catch (error) {
		console.error("Error sending test notification:", error);
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/mnav-monitor/providers - Get notification provider status
router.get("/providers", async (req: Request, res: Response) => {
	try {
		const status = notificationManager.getProviderStatus();
		const testResults = await notificationManager.testAllProviders();

		const providers = Object.keys(status).map((channelType) => ({
			enabled: true,
			...status[channelType],
			channelType,
			connectionTest: testResults[channelType] as {
				success: boolean;
				error?: string;
				timestamp: string;
			},
		}));

		const response: ApiResponse<NotificationProvidersResponse> = {
			data: {
				success: true,
				providers,
			},
		};

		res.json(response);
	} catch (error) {
		console.error("Error getting provider status:", error);
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/mnav-monitor/status - Get monitoring service status
router.get("/status", (req: Request, res: Response) => {
	try {
		const response: ApiResponse<MonitoringStatusResponse> = {
			data: {
				success: true,
				status: "running",
				monitoring_enabled: process.env.ENABLE_MNAV_MONITORING !== "false",
				check_interval_minutes: 15,
				service_uptime: process.uptime(),
			},
		};

		res.json(response);
	} catch (error) {
		console.error("Error getting monitoring status:", error);
		res.status(500).json(handleDbError(error));
	}
});

export default router;
