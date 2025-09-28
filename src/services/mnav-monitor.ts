import { supabase, supabaseServiceRole } from "../lib/supabase";
import type { NotificationData } from "./notifications/base-provider";
import { notificationManager } from "./notifications/notification-manager";

interface MnavAlert {
	id: string;
	user_id: string;
	company_id: string;
	threshold_value: number;
	alert_type: "below" | "above";
	is_active: boolean;
	last_triggered_at?: string;
	user_email?: string;
	company_ticker?: string;
	company_name?: string;
}

interface MnavCheckResult {
	company_id: string;
	current_mnav: number;
	triggered_alerts: MnavAlert[];
}

class MnavMonitorService {
	private readonly COOLDOWN_HOURS = 6; // 6 hour cooldown between alerts
	private readonly MNAV_CHANGE_THRESHOLD = 0.02; // 2% change threshold to prevent noise

	/**
	 * Calculate current MNAV for a company using the same logic as frontend
	 */
	private async calculateCurrentMnav(
		companyId: string,
	): Promise<number | null> {
		try {
			// Get the most recent company metrics
			const { data: metrics, error: metricsError } = await supabase
				.from("company_metrics")
				.select("*")
				.eq("company_id", companyId)
				.order("date", { ascending: false })
				.limit(10);

			if (metricsError || !metrics || metrics.length === 0) {
				console.error("Error fetching company metrics:", metricsError);
				return null;
			}

			// Get recent stock prices
			const { data: stockPrices, error: pricesError } = await supabase
				.from("stock_prices")
				.select("*")
				.eq("company_id", companyId)
				.order("date", { ascending: false })
				.limit(10);

			if (pricesError || !stockPrices || stockPrices.length === 0) {
				console.error("Error fetching stock prices:", pricesError);
				return null;
			}

			// Get current ETH price (you might want to fetch this from an external API)
			const currentEthPrice = await this.getCurrentEthPrice();
			if (!currentEthPrice) {
				console.error("Could not fetch current ETH price");
				return null;
			}

			// Calculate predicted MNAV using the latest data
			const latestMetric = metrics[0];
			const latestStockPrice = stockPrices[0];

			if (!latestMetric || !latestStockPrice || !latestStockPrice.close) {
				return null;
			}

			// Simple MNAV calculation: Market Cap / Total NAV Value
			const marketCap =
				(latestMetric.shares_outstanding || 0) * latestStockPrice.close;
			const totalNavValue =
				(latestMetric.eth_holdings || 0) * currentEthPrice +
				(latestMetric.usd_holdings || 0);

			if (totalNavValue <= 0) {
				return null;
			}

			return marketCap / totalNavValue;
		} catch (error) {
			console.error("Error calculating MNAV:", error);
			return null;
		}
	}

	/**
	 * Get current ETH price from a reliable source
	 */
	private async getCurrentEthPrice(): Promise<number | null> {
		try {
			// You could use Yahoo Finance, CoinGecko, or another API
			// For now, we'll return a mock price - you should implement actual ETH price fetching
			const response = await fetch(
				"https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
			);
			const data: { ethereum?: { usd?: number } } = (await response.json()) as {
				ethereum?: { usd?: number };
			};
			return data.ethereum?.usd || null;
		} catch (error) {
			console.error("Error fetching ETH price:", error);
			return 3500; // Fallback price
		}
	}

	/**
	 * Get all active alerts for monitoring
	 */
	private async getActiveAlerts(): Promise<MnavAlert[]> {
		try {
			const { data: alerts, error } = await supabaseServiceRole
				.from("mnav_threshold_alerts")
				.select(`
					*,
					user_profiles!inner(email),
					companies!inner(ticker, name)
				`)
				.eq("is_active", true);

			if (error) {
				console.error("Error fetching active alerts:", error);
				return [];
			}

			return (
				alerts?.map((alert) => ({
					id: alert.id,
					user_id: alert.user_id,
					company_id: alert.company_id,
					threshold_value: alert.threshold_value,
					alert_type: alert.alert_type,
					is_active: alert.is_active,
					last_triggered_at: alert.last_triggered_at,
					user_email: alert.user_profiles?.email,
					company_ticker: alert.companies?.ticker,
					company_name: alert.companies?.name,
				})) || []
			);
		} catch (error) {
			console.error("Error fetching active alerts:", error);
			return [];
		}
	}

	/**
	 * Check if an alert should trigger based on current MNAV
	 */
	private shouldTriggerAlert(alert: MnavAlert, currentMnav: number): boolean {
		// Check cooldown period
		if (alert.last_triggered_at) {
			const lastTriggered = new Date(alert.last_triggered_at);
			const cooldownExpiry = new Date(
				lastTriggered.getTime() + this.COOLDOWN_HOURS * 60 * 60 * 1000,
			);
			if (new Date() < cooldownExpiry) {
				return false;
			}
		}

		// Check threshold conditions
		if (alert.alert_type === "below") {
			return currentMnav < alert.threshold_value;
		}
		if (alert.alert_type === "above") {
			return currentMnav > alert.threshold_value;
		}

		return false;
	}

	/**
	 * Create notification record for triggered alert (for external email service)
	 */
	private async recordTriggeredAlert(
		alert: MnavAlert,
		currentMnav: number,
	): Promise<string | null> {
		try {
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
					})
					.select()
					.single();

			if (notificationError || !notification) {
				console.error("Error creating notification:", notificationError);
				return null;
			}

			// Update alert's last_triggered_at
			const { error: updateError } = await supabaseServiceRole
				.from("mnav_threshold_alerts")
				.update({ last_triggered_at: new Date().toISOString() })
				.eq("id", alert.id);

			if (updateError) {
				console.error("Error updating alert timestamp:", updateError);
			}

			console.log(
				`Alert recorded for ${alert.company_ticker}: MNAV ${currentMnav.toFixed(4)} ${alert.alert_type} ${alert.threshold_value}`,
			);

			return notification.id;
		} catch (error) {
			console.error("Error recording triggered alert:", error);
			return null;
		}
	}

	/**
	 * Create notification record and send alert
	 */
	private async triggerAlert(
		alert: MnavAlert,
		currentMnav: number,
	): Promise<void> {
		try {
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
						is_read: false,
					})
					.select()
					.single();

			if (notificationError || !notification) {
				console.error("Error creating notification:", notificationError);
				return;
			}

			// Update alert's last_triggered_at
			const { error: updateError } = await supabaseServiceRole
				.from("mnav_threshold_alerts")
				.update({ last_triggered_at: new Date().toISOString() })
				.eq("id", alert.id);

			if (updateError) {
				console.error("Error updating alert timestamp:", updateError);
			}

			console.log(
				`Alert triggered for ${alert.company_ticker}: MNAV ${currentMnav.toFixed(4)} ${alert.alert_type} ${alert.threshold_value}`,
			);

			// Send notifications via all configured channels
			await this.sendNotifications(notification.id, alert, currentMnav);
		} catch (error) {
			console.error("Error triggering alert:", error);
		}
	}

	/**
	 * Send notifications via notification manager
	 */
	private async sendNotifications(
		notificationId: string,
		alert: MnavAlert,
		currentMnav: number,
	): Promise<void> {
		try {
			const notificationData: NotificationData = {
				userEmail: alert.user_email || "",
				userId: alert.user_id,
				companyTicker: alert.company_ticker || "",
				companyName: alert.company_name || "",
				currentMnav,
				thresholdValue: alert.threshold_value,
				alertType: alert.alert_type,
				timestamp: new Date().toISOString(),
				notificationId,
			};

			const deliveries = await notificationManager.sendMnavAlert(
				notificationId,
				notificationData,
			);

			const successfulDeliveries = deliveries.filter((d) => d.result.success);
			const failedDeliveries = deliveries.filter((d) => !d.result.success);

			console.log(
				`Notification sent via ${successfulDeliveries.length} channels for ${alert.company_ticker}`,
			);

			if (failedDeliveries.length > 0) {
				console.warn(
					`Failed to send via ${failedDeliveries.length} channels:`,
					failedDeliveries.map((d) => `${d.channelType}: ${d.result.error}`),
				);
			}
		} catch (error) {
			console.error("Error sending notifications:", error);
		}
	}

	/**
	 * Get notification manager for external use
	 */
	public getNotificationManager() {
		return notificationManager;
	}

	/**
	 * Main monitoring function to check all alerts
	 */
	public async checkAllAlerts(): Promise<MnavCheckResult[]> {
		console.log("Starting MNAV alert monitoring check...");

		const alerts = await this.getActiveAlerts();
		if (alerts.length === 0) {
			console.log("No active alerts to check");
			return [];
		}

		console.log(`Checking ${alerts.length} active alerts`);

		// Group alerts by company to avoid redundant MNAV calculations
		const alertsByCompany = alerts.reduce(
			(acc, alert) => {
				if (!acc[alert.company_id]) {
					acc[alert.company_id] = [];
				}
				acc[alert.company_id].push(alert);
				return acc;
			},
			{} as Record<string, MnavAlert[]>,
		);

		const results: MnavCheckResult[] = [];

		for (const [companyId, companyAlerts] of Object.entries(alertsByCompany)) {
			const currentMnav = await this.calculateCurrentMnav(companyId);

			if (currentMnav === null) {
				console.warn(`Could not calculate MNAV for company ${companyId}`);
				continue;
			}

			const triggeredAlerts: MnavAlert[] = [];

			for (const alert of companyAlerts) {
				if (this.shouldTriggerAlert(alert, currentMnav)) {
					await this.triggerAlert(alert, currentMnav);
					triggeredAlerts.push(alert);
				}
			}

			results.push({
				company_id: companyId,
				current_mnav: currentMnav,
				triggered_alerts: triggeredAlerts,
			});

			if (triggeredAlerts.length > 0) {
				console.log(
					`Triggered ${triggeredAlerts.length} alerts for company ${companyId} (MNAV: ${currentMnav.toFixed(4)})`,
				);
			}
		}

		console.log(
			`MNAV monitoring check completed. Processed ${Object.keys(alertsByCompany).length} companies.`,
		);
		return results;
	}

	/**
	 * Check alerts and return data for external email service (no internal notifications sent)
	 */
	public async checkAlertsForExternalEmail(): Promise<{
		triggered_alerts: Array<{
			alert_id: string;
			user_email: string;
			company_ticker: string;
			company_name: string;
			current_mnav: number;
			threshold_value: number;
			alert_type: "below" | "above";
			triggered_at: string;
		}>;
		total_companies_checked: number;
		total_alerts_triggered: number;
	}> {
		console.log("Starting MNAV alert check for external email service...");

		const alerts = await this.getActiveAlerts();
		if (alerts.length === 0) {
			console.log("No active alerts to check");
			return {
				triggered_alerts: [],
				total_companies_checked: 0,
				total_alerts_triggered: 0,
			};
		}

		console.log(
			`Checking ${alerts.length} active alerts for external email service`,
		);

		// Group alerts by company to avoid redundant MNAV calculations
		const alertsByCompany = alerts.reduce(
			(acc, alert) => {
				if (!acc[alert.company_id]) {
					acc[alert.company_id] = [];
				}
				acc[alert.company_id].push(alert);
				return acc;
			},
			{} as Record<string, MnavAlert[]>,
		);

		const triggeredAlerts: Array<{
			alert_id: string;
			user_email: string;
			company_ticker: string;
			company_name: string;
			current_mnav: number;
			threshold_value: number;
			alert_type: "below" | "above";
			triggered_at: string;
		}> = [];

		const companiesChecked = Object.keys(alertsByCompany).length;

		for (const [companyId, companyAlerts] of Object.entries(alertsByCompany)) {
			const currentMnav = await this.calculateCurrentMnav(companyId);

			if (currentMnav === null) {
				console.warn(`Could not calculate MNAV for company ${companyId}`);
				continue;
			}

			for (const alert of companyAlerts) {
				if (this.shouldTriggerAlert(alert, currentMnav)) {
					// Record the alert in our database but don't send notifications
					const notificationId = await this.recordTriggeredAlert(
						alert,
						currentMnav,
					);

					if (notificationId) {
						triggeredAlerts.push({
							alert_id: alert.id,
							user_email: alert.user_email || "",
							company_ticker: alert.company_ticker || "",
							company_name: alert.company_name || "",
							current_mnav: currentMnav,
							threshold_value: alert.threshold_value,
							alert_type: alert.alert_type,
							triggered_at: new Date().toISOString(),
						});
					}
				}
			}
		}

		console.log(
			`External email check completed. ${triggeredAlerts.length} alerts triggered across ${companiesChecked} companies.`,
		);

		return {
			triggered_alerts: triggeredAlerts,
			total_companies_checked: companiesChecked,
			total_alerts_triggered: triggeredAlerts.length,
		};
	}

	/**
	 * Start monitoring with periodic checks
	 */
	public startMonitoring(intervalMinutes = 15): void {
		console.log(
			`Starting MNAV monitoring service with ${intervalMinutes}-minute intervals`,
		);

		// Run initial check
		this.checkAllAlerts();

		// Set up periodic checks
		setInterval(
			() => {
				this.checkAllAlerts();
			},
			intervalMinutes * 60 * 1000,
		);
	}
}

export const mnavMonitor = new MnavMonitorService();
