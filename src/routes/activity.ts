import { type Request, type Response, Router } from "express";
import { handleDbError, supabase, supabaseServiceRole } from "../lib/supabase";
import type {
	ActivityStatsResponse,
	ApiResponse,
	TrackActivityRequest,
	TrackActivityResponse,
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

// Helper functions for date/time validation
function isMarketDay(date?: string | Date): boolean {
	const targetDate = date ? new Date(date) : new Date();
	const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 6 = Saturday
	return dayOfWeek !== 0 && dayOfWeek !== 6; // Not Sunday or Saturday
}

function getTodayDateString(): string {
	return new Date().toISOString().split("T")[0];
}

function getWeekStart(date?: string | Date): string {
	const targetDate = date ? new Date(date) : new Date();
	const weekStart = new Date(targetDate);
	weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
	return weekStart.toISOString().split("T")[0];
}

// Type guard for request body validation
function validateTrackActivityRequest(
	body: unknown,
): body is TrackActivityRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { activity_type, duration_seconds, session_id } = request;

	// Check activity_type
	if (!["dashboard_view", "poll_vote"].includes(activity_type as string))
		return false;

	// Check session_id
	if (typeof session_id !== "string" || !session_id) return false;

	// Check duration_seconds if provided
	if (duration_seconds !== undefined) {
		if (
			typeof duration_seconds !== "number" ||
			duration_seconds < 0 ||
			duration_seconds > 600
		) {
			return false;
		}
	}

	return true;
}

// POST /api/activity/track - Track user activity
router.post("/track", async (req: Request, res: Response) => {
	try {
		// Validate request body
		if (!validateTrackActivityRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: activity_type ('dashboard_view' | 'poll_vote'), session_id (string). Optional: duration_seconds (0-600)",
			});
		}

		const { activity_type, duration_seconds, session_id } = req.body;

		// Get user (can be null for anonymous users)
		const userResult = await getAuthenticatedUser(req);
		const user = userResult?.user;

		// Only track dashboard_view for logged-in users (for now)
		if (activity_type === "dashboard_view" && !user) {
			return res.status(401).json({
				error: "Authentication required for activity tracking",
			});
		}

		// Check daily activity limit (max 20 points per day, only on market days)
		if (activity_type === "dashboard_view" && duration_seconds) {
			const today = getTodayDateString();

			// Only award points on weekdays (market days)
			if (!isMarketDay()) {
				const response: ApiResponse<TrackActivityResponse> = {
					data: { points_awarded: 0 },
					message:
						"Activity tracking is only available on weekdays (market days)",
				};
				return res.json(response);
			}

			const { data: todayPoints } = await supabase
				.from("leaderboard_points")
				.select("points")
				.eq("user_id", user?.id)
				.eq("point_type", "activity")
				.eq("awarded_date", today);

			const currentPoints =
				todayPoints?.reduce((sum, record) => sum + record.points, 0) || 0;

			const newPoints = Math.min(duration_seconds / 20, 20 - currentPoints);

			if (newPoints <= 0) {
				const response: ApiResponse<TrackActivityResponse> = {
					data: { points_awarded: 0 },
					message: "Daily activity limit reached",
				};
				return res.json(response);
			}

			// Record activity using service role to bypass RLS
			const { error: activityError } = await supabaseServiceRole
				.from("user_activity")
				.insert({
					user_id: user?.id,
					session_id,
					activity_type,
					duration_seconds,
				});

			if (activityError) {
				console.error("Error recording activity:", activityError);
				return res.status(500).json({ error: "Failed to record activity" });
			}

			// Award points if applicable using service role
			if (newPoints > 0) {
				const { error: pointsError } = await supabaseServiceRole
					.from("leaderboard_points")
					.insert({
						user_id: user?.id,
						point_type: "activity",
						points: Math.floor(newPoints),
						awarded_date: today,
					});

				if (pointsError) {
					console.error("Error awarding points:", pointsError);
					// Continue anyway - activity was recorded
				}
			}

			const response: ApiResponse<TrackActivityResponse> = {
				data: { points_awarded: Math.floor(newPoints) },
				message: "Activity tracked successfully",
			};
			return res.json(response);
		}

		// For poll_vote activity (no duration, just tracking)
		if (activity_type === "poll_vote") {
			const { error: activityError } = await supabaseServiceRole
				.from("user_activity")
				.insert({
					user_id: user?.id,
					session_id,
					activity_type,
				});

			if (activityError) {
				console.error("Error recording poll vote activity:", activityError);
				return res.status(500).json({ error: "Failed to record activity" });
			}

			const response: ApiResponse<TrackActivityResponse> = {
				data: { points_awarded: 0 },
				message: "Poll vote activity tracked successfully",
			};
			return res.json(response);
		}

		return res
			.status(400)
			.json({ error: "Invalid activity type or missing data" });
	} catch (error) {
		console.error("Activity tracking error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/activity/stats - Get user activity statistics
router.get("/stats", async (req: Request, res: Response) => {
	try {
		// Require authentication for stats
		const userResult = await getAuthenticatedUser(req);
		if (!userResult) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const { user } = userResult;
		const date = (req.query.date as string) || getTodayDateString();
		const isMarketToday = isMarketDay(date);

		// Get activity points for the specified date
		const { data: points, error } = await supabase
			.from("leaderboard_points")
			.select("points")
			.eq("user_id", user.id)
			.eq("point_type", "activity")
			.eq("awarded_date", date);

		if (error) {
			return res.status(500).json({ error: "Failed to fetch activity stats" });
		}

		// Sum up total points for the day
		const totalPoints =
			points?.reduce((sum, record) => sum + record.points, 0) || 0;

		// Get weekly stats
		const weekStartStr = getWeekStart(date);
		const { data: weekPoints } = await supabase
			.from("leaderboard_points")
			.select("points, awarded_date")
			.eq("user_id", user.id)
			.eq("point_type", "activity")
			.gte("awarded_date", weekStartStr)
			.lte("awarded_date", date);

		const weeklyTotal =
			weekPoints?.reduce((sum, record) => sum + record.points, 0) || 0;
		const activeDays = new Set(weekPoints?.map((record) => record.awarded_date))
			.size;

		const response: ApiResponse<ActivityStatsResponse> = {
			data: {
				daily_points: totalPoints,
				weekly_points: weeklyTotal,
				active_days_this_week: activeDays,
				date: date,
				max_daily_points: 20, // Daily limit
				is_market_day: isMarketToday,
			},
		};

		res.json(response);
	} catch (error) {
		console.error("Activity stats error:", error);
		res.status(500).json(handleDbError(error));
	}
});

export default router;
