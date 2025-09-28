export interface NotificationData {
	userEmail: string;
	userId: string;
	userName?: string;
	companyTicker: string;
	companyName: string;
	currentMnav: number;
	thresholdValue: number;
	alertType: "above" | "below";
	timestamp: string;
	notificationId: string;
}

export interface DeliveryResult {
	success: boolean;
	messageId?: string;
	error?: string;
	providerId?: string;
	deliveredAt?: string;
	metadata?: Record<string, unknown>;
}

export interface NotificationProvider {
	readonly channelType: string;
	readonly providerName: string;

	/**
	 * Initialize the provider with configuration
	 */
	initialize(config: Record<string, unknown>): Promise<void>;

	/**
	 * Check if the provider is properly configured and ready
	 */
	isConfigured(): boolean;

	/**
	 * Send a notification
	 */
	sendNotification(
		recipient: string,
		data: NotificationData,
	): Promise<DeliveryResult>;

	/**
	 * Validate recipient format (email, phone, chat_id, etc.)
	 */
	validateRecipient(recipient: string): boolean;

	/**
	 * Get delivery status for a message (if supported)
	 */
	getDeliveryStatus?(messageId: string): Promise<{
		status: "pending" | "delivered" | "failed" | "bounced";
		deliveredAt?: string;
		error?: string;
	}>;

	/**
	 * Test the provider configuration
	 */
	testConnection?(): Promise<boolean>;
}

export abstract class BaseNotificationProvider implements NotificationProvider {
	abstract readonly channelType: string;
	abstract readonly providerName: string;

	protected config: Record<string, unknown> = {};
	protected isInitialized = false;

	async initialize(config: Record<string, unknown>): Promise<void> {
		this.config = config;
		this.isInitialized = true;
	}

	isConfigured(): boolean {
		return this.isInitialized;
	}

	abstract sendNotification(
		recipient: string,
		data: NotificationData,
	): Promise<DeliveryResult>;

	abstract validateRecipient(recipient: string): boolean;

	/**
	 * Generate notification content based on alert data
	 */
	protected generateContent(data: NotificationData): {
		subject: string;
		message: string;
		html?: string;
	} {
		const direction =
			data.alertType === "below" ? "dropped below" : "rose above";
		const emoji = data.alertType === "below" ? "📉" : "📈";
		const percentage =
			data.alertType === "below"
				? ((1 - data.currentMnav) * 100).toFixed(1)
				: ((data.currentMnav - 1) * 100).toFixed(1);

		const subject = `${emoji} MNAV Alert: ${data.companyTicker} ${direction} ${data.thresholdValue.toFixed(2)}`;

		const message = [
			"🚨 MNAV Alert Triggered!",
			"",
			"Company: ${data.companyTicker} - ${data.companyName}",
			"Alert: MNAV ${direction} ${data.thresholdValue.toFixed(2)}",
			"Current MNAV: ${data.currentMnav.toFixed(4)}",
			"",
			data.alertType === "below"
				? `💡 The stock is trading at a ${percentage}% discount to NAV`
				: `⚠️ The stock is trading at a ${percentage}% premium to NAV`,
			"",
			"🔗 View dashboard: https://bmnr.rocks",
			"⚙️ Manage alerts: https://bmnr.rocks/settings/alerts",
		].join("\n");

		return { subject, message };
	}
}
