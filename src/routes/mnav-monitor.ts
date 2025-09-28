import { type Request, type Response, Router } from "express";
import { handleDbError, supabaseServiceRole } from "../lib/supabase";
import type { ApiResponse } from "../types";

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

// Helper function to fetch current ETH price from CoinGecko
async function getCurrentEthPrice(): Promise<number> {
	try {
		const response = await fetch(
			"https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
		);
		const data = (await response.json()) as { ethereum?: { usd?: number } };
		return data.ethereum?.usd || 0;
	} catch (error) {
		console.error("Error fetching ETH price:", error);
		return 0;
	}
}

// Helper function to fetch current BMNR stock price
async function getCurrentBmnrPrice(): Promise<number> {
	try {
		// Try to get from realtime stock prices table first
		const { data: realtimePrice } = await supabaseServiceRole
			.from("realtime_stock_prices")
			.select("price")
			.eq("ticker", "BMNR")
			.single();

		if (realtimePrice?.price) {
			return realtimePrice.price;
		}

		// Fallback to latest stock_prices entry
		const { data: stockPrice } = await supabaseServiceRole
			.from("stock_prices")
			.select("close")
			.eq("company_id", "4bf5e88a-dfba-44d0-bdfb-7d878cbd10db") // BMNR company ID
			.order("date", { ascending: false })
			.limit(1)
			.single();

		return stockPrice?.close || 0;
	} catch (error) {
		console.error("Error fetching BMNR price:", error);
		return 0;
	}
}

// Helper function to get latest company metrics
async function getLatestCompanyMetrics(companyId: string) {
	try {
		const { data: metrics, error } = await supabaseServiceRole
			.from("company_metrics")
			.select("*")
			.eq("company_id", companyId)
			.order("date", { ascending: false })
			.limit(1)
			.single();

		if (error) {
			console.error("Error fetching company metrics:", error);
			return null;
		}

		return metrics;
	} catch (error) {
		console.error("Error in getLatestCompanyMetrics:", error);
		return null;
	}
}

// Helper function to get alternative assets current value
async function getAlternativeAssetsValue(companyId: string): Promise<number> {
	try {
		const { data: portfolio } = await supabaseServiceRole
			.from("alternative_assets")
			.select("shares_remaining, current_price")
			.eq("company_id", companyId)
			.eq("status", "active");

		if (!portfolio || portfolio.length === 0) {
			return 0;
		}

		// Calculate total current value
		const totalValue = portfolio.reduce((sum, asset) => {
			const currentValue =
				(asset.shares_remaining || 0) * (asset.current_price || 0);
			return sum + currentValue;
		}, 0);

		return totalValue;
	} catch (error) {
		console.error("Error fetching alternative assets value:", error);
		return 0;
	}
}

// Calculate current MNAV for a company
async function calculateCurrentMnav(companyId: string): Promise<number | null> {
	try {
		// Get latest metrics
		const metrics = await getLatestCompanyMetrics(companyId);
		if (!metrics) {
			console.error("No metrics found for company:", companyId);
			return null;
		}

		// Get current prices
		const [ethPrice, stockPrice] = await Promise.all([
			getCurrentEthPrice(),
			getCurrentBmnrPrice(),
		]);

		if (!ethPrice || !stockPrice) {
			console.error(
				"Missing price data - ETH:",
				ethPrice,
				"Stock:",
				stockPrice,
			);
			return null;
		}

		// Get alternative assets value
		const alternativeAssetsValue = await getAlternativeAssetsValue(companyId);

		// Calculate MNAV using the same logic as frontend
		const ethMarketValue = (metrics.eth_holdings || 0) * ethPrice;
		const usdHoldings = metrics.usd_holdings || 0;
		const totalNavValue = ethMarketValue + usdHoldings + alternativeAssetsValue;

		// Calculate market cap
		const sharesOutstanding = metrics.shares_outstanding || 0;
		const marketCap = stockPrice * sharesOutstanding;

		if (totalNavValue === 0) {
			console.error("Total NAV value is zero for company:", companyId);
			return null;
		}

		const mNav = marketCap / totalNavValue;

		console.log(`MNAV calculation for ${companyId}:`, {
			ethHoldings: metrics.eth_holdings,
			ethPrice,
			ethMarketValue,
			usdHoldings,
			alternativeAssetsValue,
			totalNavValue,
			sharesOutstanding,
			stockPrice,
			marketCap,
			mNav,
		});

		return mNav;
	} catch (error) {
		console.error("Error calculating MNAV:", error);
		return null;
	}
}

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

		// Group alerts by company to avoid redundant calculations
		const alertsByCompany = alerts.reduce(
			(acc, alert) => {
				const companyId = alert.company_id;
				if (!acc[companyId]) {
					acc[companyId] = [];
				}
				acc[companyId].push(alert);
				return acc;
			},
			{} as Record<string, typeof alerts>,
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
			for (const alert of companyAlerts as typeof alerts) {
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
