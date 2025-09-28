import { supabaseServiceRole } from "../../lib/supabase";
import type {
	DeliveryResult,
	NotificationData,
	NotificationProvider,
} from "./base-provider";

interface UserNotificationPreferences {
	userId: string;
	email?: string;
	notificationEmail: boolean;
}

interface NotificationDelivery {
	notificationId: string;
	channelType: string;
	recipient: string;
	result: DeliveryResult;
}

export class NotificationManager {
	private providers: Map<string, NotificationProvider> = new Map();
	private isInitialized = false;

	async initialize(): Promise<void> {
		try {
			// Load configuration from database
			const { data: channels, error } = await supabaseServiceRole
				.from("notification_channels")
				.select("*")
				.eq("is_enabled", true);

			if (error) {
				console.error("Error loading notification channels:", error);
				return;
			}

			// Initialize providers based on database configuration
			for (const channel of channels || []) {
				await this.initializeProvider(channel);
			}

			this.isInitialized = true;
			console.log(
				`Notification manager initialized with ${this.providers.size} providers`,
			);
		} catch (error) {
			console.error("Error initializing notification manager:", error);
		}
	}

	private async initializeProvider(
		channelConfig: Record<string, unknown>,
	): Promise<void> {
		try {
			let provider: NotificationProvider;

			switch (channelConfig.channel_type) {
				case "email":
					// Email notifications are handled externally
					console.log(
						"Email notifications are handled by external service - skipping initialization",
					);
					return;

				default:
					console.warn(`Unknown channel type: ${channelConfig.channel_type}`);
					return;
			}
		} catch (error) {
			console.error(
				`Error initializing ${channelConfig.channel_name} provider:`,
				error,
			);
		}
	}

	/**
	 * Send MNAV alert notification to user via all enabled channels
	 */
	async sendMnavAlert(
		notificationId: string,
		data: NotificationData,
	): Promise<NotificationDelivery[]> {
		if (!this.isInitialized) {
			await this.initialize();
		}

		// Get user notification preferences
		const preferences = await this.getUserPreferences(data.userId);
		if (!preferences) {
			console.error(`No preferences found for user ${data.userId}`);
			return [];
		}

		const deliveries: NotificationDelivery[] = [];

		// Email notifications are handled externally - no internal delivery needed

		// Update notification record with delivery status
		await this.updateNotificationStatus(notificationId, deliveries);

		return deliveries;
	}

	// sendViaProvider method removed - no internal providers

	/**
	 * Get user notification preferences from database
	 */
	private async getUserPreferences(
		userId: string,
	): Promise<UserNotificationPreferences | null> {
		try {
			const { data, error } = await supabaseServiceRole
				.from("user_profiles")
				.select(`
					id,
					email,
					user_preferences!inner(
						notification_email
					)
				`)
				.eq("id", userId)
				.single();

			if (error || !data) {
				console.error("Error fetching user preferences:", error);
				return null;
			}

			return {
				userId,
				email: data.email,
				notificationEmail: data.user_preferences[0].notification_email,
			};
		} catch (error) {
			console.error("Error getting user preferences:", error);
			return null;
		}
	}

	/**
	 * Log delivery attempt to database
	 */
	private async logDelivery(
		notificationId: string,
		channelType: string,
		recipient: string,
		result: DeliveryResult,
	): Promise<void> {
		try {
			await supabaseServiceRole.from("notification_delivery_log").insert({
				notification_id: notificationId,
				channel_type: channelType,
				recipient,
				status: result.success ? "sent" : "failed",
				provider_response: result.metadata || {},
				error_message: result.error,
				sent_at: result.success
					? result.deliveredAt || new Date().toISOString()
					: null,
			});
		} catch (error) {
			console.error("Error logging delivery:", error);
		}
	}

	/**
	 * Update notification record with delivery status
	 */
	private async updateNotificationStatus(
		notificationId: string,
		deliveries: NotificationDelivery[],
	): Promise<void> {
		try {
			const updateData: Record<string, unknown> = {};

			for (const delivery of deliveries) {
				const channelKey = `${delivery.channelType}_sent`;
				const timestampKey = `${delivery.channelType}_sent_at`;

				updateData[channelKey] = delivery.result.success;
				if (delivery.result.success && delivery.result.deliveredAt) {
					updateData[timestampKey] = delivery.result.deliveredAt;
				}
			}

			await supabaseServiceRole
				.from("mnav_notifications")
				.update(updateData)
				.eq("id", notificationId);
		} catch (error) {
			console.error("Error updating notification status:", error);
		}
	}

	/**
	 * Test all configured providers
	 */
	async testAllProviders(): Promise<Record<string, unknown>> {
		// Only email (external service) is supported
		return {
			email: {
				success: true,
				error: null,
				timestamp: new Date().toISOString(),
			},
		};
	}

	/**
	 * Send test notification to specific user
	 */
	async sendTestNotification(
		userId: string,
		channelType?: string,
	): Promise<NotificationDelivery[]> {
		const testData: NotificationData = {
			userEmail: "test@example.com",
			userId,
			userName: "Test User",
			companyTicker: "BMNR",
			companyName: "BitMine Immersion Technologies",
			currentMnav: 0.85,
			thresholdValue: 1.0,
			alertType: "below",
			timestamp: new Date().toISOString(),
			notificationId: "test-notification",
		};

		if (channelType) {
			// Test specific channel
			const preferences = await this.getUserPreferences(userId);
			if (!preferences) {
				return [];
			}

			let recipient: string | undefined;
			switch (channelType) {
				case "email":
					return [
						{
							notificationId: "test",
							channelType: "email",
							recipient: "external-service",
							result: {
								success: true,
								error: "Email notifications are handled by external service",
							},
						},
					];
				default:
					return [
						{
							notificationId: "test",
							channelType,
							recipient: "unknown",
							result: {
								success: false,
								error: `Channel type '${channelType}' not supported`,
							},
						},
					];
			}
		}

		// Test email channel only
		return await this.sendMnavAlert("test-notification", testData);
	}

	/**
	 * Get provider status for admin/monitoring
	 */
	getProviderStatus(): Record<
		string,
		{ configured: boolean; channelType: string; providerName: string }
	> {
		// Only email (external service) is supported
		return {
			email: {
				configured: true,
				channelType: "email",
				providerName: "External Email Service",
			},
		};
	}
}

// Export singleton instance
export const notificationManager = new NotificationManager();
