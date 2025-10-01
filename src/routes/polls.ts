import { type Request, type Response, Router } from "express";
import { handleDbError, supabase, supabaseServiceRole } from "../lib/supabase";
import { getAuthenticatedUser } from "../lib/user-authentication";
import type {
	ApiResponse,
	AutoCreatePollRequest,
	AutoSettlePollRequest,
	CreateDailyPollRequest,
	DailyPoll,
	DailyPollVote,
	SettlePollRequest,
	SubmitVoteRequest,
} from "../types";

const router: Router = Router();

// Helper function to check admin permissions
async function requireAdminAuth(req: Request) {
	const userResult = await getAuthenticatedUser(req);
	if (!userResult) {
		return { error: "Authentication required", status: 401 };
	}

	// Check if user is admin
	const { data: profile } = await supabase
		.from("user_profiles")
		.select("role")
		.eq("id", userResult.user.id)
		.single();

	if (!profile || profile.role !== "admin") {
		return { error: "Admin access required", status: 403 };
	}

	return { user: userResult.user };
}

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

// Helper functions for date/time validation
function getTodayDateString(): string {
	return new Date().toISOString().split("T")[0];
}

function calculateMarketHours(
	pollDate: string,
	customOpenTime?: string,
	customCloseTime?: string,
) {
	// Default market hours in ET (Eastern Time)
	// 9:30 AM ET = 1:30 PM UTC, 4:00 PM ET = 8:00 PM UTC
	const marketOpen = customOpenTime
		? new Date(customOpenTime)
		: new Date(`${pollDate}T13:30:00.000Z`); // 9:30 AM ET

	const marketClose = customCloseTime
		? new Date(customCloseTime)
		: new Date(`${pollDate}T20:00:00.000Z`); // 4:00 PM ET

	// Calculate cutoff time (1 hour before market close)
	const cutoffTime = new Date(marketClose);
	cutoffTime.setHours(cutoffTime.getHours() - 1);

	// Calculate early bonus cutoff (first half of trading day)
	const marketOpenMs = marketOpen.getTime();
	const marketCloseMs = marketClose.getTime();
	const tradingDayDurationMs = marketCloseMs - marketOpenMs;
	const earlyBonusCutoff = new Date(marketOpenMs + tradingDayDurationMs / 2);

	return {
		marketOpen,
		marketClose,
		cutoffTime,
		earlyBonusCutoff,
	};
}

function isPastPollDate(pollDate: string): boolean {
	const today = getTodayDateString();
	return pollDate < today;
}

function isPastCutoffTime(cutoffTime: string | Date): boolean {
	const now = new Date();
	const cutoff = new Date(cutoffTime);
	return now > cutoff;
}

function isEarlyBonus(earlyBonusCutoff: string | Date): boolean {
	const now = new Date();
	const cutoff = new Date(earlyBonusCutoff);
	return now <= cutoff;
}

// Type guards for request validation
function validateCreateDailyPollRequest(
	body: unknown,
): body is CreateDailyPollRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { asset_symbol, poll_date, step_size, max_points } = request;

	// Check asset_symbol
	if (!["BMNR", "SBET", "BTBT", "ETH-USD"].includes(asset_symbol as string))
		return false;

	// Check poll_date format (YYYY-MM-DD)
	if (typeof poll_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(poll_date))
		return false;

	// Check optional fields
	if (
		step_size !== undefined &&
		(typeof step_size !== "number" || step_size <= 0)
	)
		return false;
	if (
		max_points !== undefined &&
		(typeof max_points !== "number" || max_points <= 0)
	)
		return false;

	return true;
}

function validateSubmitVoteRequest(body: unknown): body is SubmitVoteRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { poll_id, predicted_price } = request;

	// Check poll_id (UUID format)
	if (typeof poll_id !== "string" || !poll_id) return false;

	// Check predicted_price
	if (typeof predicted_price !== "number" || predicted_price <= 0) return false;

	return true;
}

function validateSettlePollRequest(body: unknown): body is SettlePollRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { poll_id, target_price } = request;

	// Check poll_id (UUID format)
	if (typeof poll_id !== "string" || !poll_id) return false;

	// Check target_price
	if (typeof target_price !== "number" || target_price <= 0) return false;

	return true;
}

function validateAutoSettlePollRequest(
	body: unknown,
): body is AutoSettlePollRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { asset_symbol, poll_date, target_price } = request;

	// Check asset_symbol
	if (!["BMNR", "SBET", "BTBT", "ETH-USD"].includes(asset_symbol as string))
		return false;

	// Check poll_date format (YYYY-MM-DD)
	if (typeof poll_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(poll_date))
		return false;

	// Check target_price
	if (typeof target_price !== "number" || target_price <= 0) return false;

	return true;
}

function validateAutoCreatePollRequest(
	body: unknown,
): body is AutoCreatePollRequest {
	if (!body || typeof body !== "object") return false;

	const request = body as Record<string, unknown>;
	const { date, assets } = request;

	// Check date format (YYYY-MM-DD)
	if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
		return false;

	// Check assets array
	if (!Array.isArray(assets) || assets.length === 0) return false;
	if (
		!assets.every((asset) =>
			["BMNR", "SBET", "BTBT", "ETH-USD"].includes(asset),
		)
	)
		return false;

	return true;
}

// GET /api/polls/daily - Get daily polls
router.get("/daily", async (req: Request, res: Response) => {
	try {
		const { date, asset } = req.query;

		const queryDate = (date as string) || getTodayDateString();

		let query = supabaseServiceRole
			.from("daily_polls")
			.select("*")
			.eq("poll_date", queryDate)
			.order("created_at", { ascending: false });

		if (
			asset &&
			(asset === "BMNR" ||
				asset === "SBET" ||
				asset === "BTBT" ||
				asset === "ETH-USD")
		) {
			query = query.eq("asset_symbol", asset);
		}

		const { data: polls, error } = await query;

		if (error) {
			console.error("Error fetching daily polls:", error);
			return res.status(500).json({ error: "Failed to fetch daily polls" });
		}

		const response: ApiResponse<DailyPoll[]> = {
			data: polls || [],
		};

		res.json(response);
	} catch (error) {
		console.error("Daily polls GET error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/polls/daily - Create daily poll (admin only)
router.post("/daily", async (req: Request, res: Response) => {
	try {
		const authResult = await requireAdminAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult?.status || 500)
				.json({ error: authResult.error });
		}

		if (!validateCreateDailyPollRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: asset_symbol ('BMNR' | 'SBET' | 'BTBT' | 'ETH-USD'), poll_date (YYYY-MM-DD). Optional: step_size (number), max_points (number)",
			});
		}

		const {
			asset_symbol,
			poll_date,
			step_size,
			max_points,
			market_open_time,
			market_close_time,
		} = req.body;

		// Set default step sizes based on asset
		const defaultStepSize = asset_symbol === "BMNR" ? 0.01 : 0.1;
		const finalStepSize = step_size || defaultStepSize;
		const finalMaxPoints = max_points || 100;

		// Calculate market hours using utility function
		const marketHours = calculateMarketHours(
			poll_date,
			market_open_time,
			market_close_time,
		);

		// Create daily poll
		const { data: poll, error } = await supabaseServiceRole
			.from("daily_polls")
			.insert({
				asset_symbol,
				poll_date,
				step_size: finalStepSize,
				max_points: finalMaxPoints,
				market_open_time: marketHours.marketOpen,
				market_close_time: marketHours.marketClose,
				cutoff_time: marketHours.cutoffTime,
				early_bonus_cutoff: marketHours.earlyBonusCutoff,
			})
			.select()
			.single();

		if (error) {
			if (error.code === "23505") {
				// Unique constraint violation
				return res.status(409).json({
					error: "Daily poll already exists for this date and asset",
				});
			}
			console.error("Error creating daily poll:", error);
			return res.status(500).json({ error: "Failed to create daily poll" });
		}

		const response: ApiResponse<DailyPoll> = {
			data: poll,
			message: "Daily poll created successfully",
		};

		res.json(response);
	} catch (error) {
		console.error("Create daily poll error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/polls/daily/votes - Get user votes for poll
router.get("/daily/votes", async (req: Request, res: Response) => {
	try {
		const { poll_id, user_id, limit } = req.query;

		if (!poll_id) {
			return res.status(400).json({ error: "poll_id is required" });
		}

		const queryLimit = Math.min(
			Number.parseInt((limit as string) || "100"),
			1000,
		);

		let query = supabaseServiceRole
			.from("daily_poll_votes")
			.select("*")
			.eq("poll_id", poll_id)
			.order("created_at", { ascending: false })
			.limit(queryLimit);

		// If user_id is provided, filter by it
		if (user_id) {
			query = query.eq("user_id", user_id);
		}

		const { data: votes, error } = await query;

		if (error) {
			console.error("Error fetching daily poll votes:", error);
			return res.status(500).json({ error: "Failed to fetch votes" });
		}

		const response: ApiResponse<DailyPollVote[]> = {
			data: votes || [],
		};

		res.json(response);
	} catch (error) {
		console.error("Daily poll votes GET error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/polls/daily/vote - Submit/update vote
router.post("/daily/vote", async (req: Request, res: Response) => {
	try {
		const userResult = await getAuthenticatedUser(req);
		if (!userResult) {
			return res.status(401).json({ error: "Authentication required" });
		}

		if (!validateSubmitVoteRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: poll_id (string), predicted_price (number > 0)",
			});
		}

		const { poll_id, predicted_price } = req.body;

		// Verify poll exists and is open
		const { data: poll, error: pollError } = await supabaseServiceRole
			.from("daily_polls")
			.select("*")
			.eq("id", poll_id)
			.eq("status", "open")
			.single();

		if (pollError || !poll) {
			return res.status(404).json({
				error: "Poll not found or no longer accepting votes",
			});
		}

		// Check if poll is for today or future (can't vote on past polls)
		if (isPastPollDate(poll.poll_date)) {
			return res.status(400).json({
				error: "Cannot vote on past polls",
			});
		}

		// Check if voting is still allowed (cutoff time validation)
		if (poll.cutoff_time && isPastCutoffTime(poll.cutoff_time)) {
			return res.status(400).json({
				error: "Voting has closed for this poll (cutoff time reached)",
			});
		}

		// Check if user qualifies for early bonus (voted in first half of trading day)
		const earlyBonus =
			poll.early_bonus_cutoff && isEarlyBonus(poll.early_bonus_cutoff);

		// Insert or update vote (upsert)
		const { data: vote, error: voteError } = await supabaseServiceRole
			.from("daily_poll_votes")
			.upsert(
				{
					poll_id,
					user_id: userResult.user.id,
					predicted_price,
					early_bonus_applied: earlyBonus,
				},
				{
					onConflict: "poll_id,user_id",
				},
			)
			.select()
			.single();

		if (voteError) {
			console.error("Error recording vote:", voteError);
			return res.status(500).json({ error: "Failed to record vote" });
		}

		// Track poll vote activity through activity tracking API
		try {
			const activityResponse = await fetch(
				`${process.env.API_BASE || "http://localhost:4000"}/api/activity/track`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: req.headers.authorization || "",
					},
					body: JSON.stringify({
						activity_type: "poll_vote",
						session_id: crypto.randomUUID(),
					}),
				},
			);

			if (!activityResponse.ok) {
				console.warn("Failed to track poll vote activity");
			}
		} catch (error) {
			console.warn("Error tracking poll vote activity:", error);
		}

		const response: ApiResponse<DailyPollVote> = {
			data: vote,
			message: "Vote recorded successfully",
		};

		res.json(response);
	} catch (error) {
		console.error("Submit vote error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/polls/daily/settle - Manually settle poll (admin only)
router.post("/daily/settle", async (req: Request, res: Response) => {
	try {
		const authResult = await requireAdminAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult?.status || 500)
				.json({ error: authResult.error });
		}

		if (!validateSettlePollRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: poll_id (string), target_price (number > 0)",
			});
		}

		const { poll_id, target_price } = req.body;

		// Find the poll and verify it's open
		const { data: poll, error: pollError } = await supabaseServiceRole
			.from("daily_polls")
			.select("*")
			.eq("id", poll_id)
			.eq("status", "open")
			.single();

		if (pollError || !poll) {
			return res.status(404).json({
				error: "Open poll not found",
			});
		}

		// Update poll with target price and settled status
		const { error: updateError } = await supabaseServiceRole
			.from("daily_polls")
			.update({
				target_price,
				status: "settled",
			})
			.eq("id", poll.id);

		if (updateError) {
			console.error("Error updating poll:", updateError);
			return res.status(500).json({ error: "Failed to update poll" });
		}

		// Get all votes for this poll
		const { data: votes, error: votesError } = await supabaseServiceRole
			.from("daily_poll_votes")
			.select("*")
			.eq("poll_id", poll.id);

		if (votesError) {
			console.error("Error fetching votes:", votesError);
			return res.status(500).json({ error: "Failed to fetch votes" });
		}

		// Calculate points for each vote and update
		const pointsUpdates = [];
		const leaderboardPoints = [];

		for (const vote of votes || []) {
			// Calculate base points using accuracy formula
			const stepDifference =
				Math.abs(target_price - vote.predicted_price) / poll.step_size;
			const basePoints = Math.max(
				0,
				Math.floor(poll.max_points - stepDifference),
			);

			// Apply 2x bonus for early predictions
			const finalPoints = vote.early_bonus_applied
				? basePoints * 2
				: basePoints;

			pointsUpdates.push({
				id: vote.id,
				points_earned: finalPoints,
			});

			if (finalPoints > 0) {
				leaderboardPoints.push({
					user_id: vote.user_id,
					point_type: "daily_poll",
					points: finalPoints,
					source_id: vote.id,
					awarded_date: poll.poll_date,
				});
			}
		}

		// Update vote records with points earned
		let updatedVotes = 0;
		if (pointsUpdates.length > 0) {
			for (const update of pointsUpdates) {
				const { error: updateVoteError } = await supabaseServiceRole
					.from("daily_poll_votes")
					.update({ points_earned: update.points_earned })
					.eq("id", update.id);

				if (updateVoteError) {
					console.error("Error updating vote points:", updateVoteError);
					// Continue with other updates
				} else {
					updatedVotes++;
				}
			}
		}

		// Insert leaderboard points
		let insertedPoints = 0;
		if (leaderboardPoints.length > 0) {
			// Check if leaderboard points already exist for this poll to avoid duplicates
			const { data: existingPoints } = await supabaseServiceRole
				.from("leaderboard_points")
				.select("source_id")
				.in(
					"source_id",
					pointsUpdates.map((p) => p.id),
				);

			const existingSourceIds = new Set(
				existingPoints?.map((p) => p.source_id) || [],
			);
			const newPoints = leaderboardPoints.filter(
				(p) => !existingSourceIds.has(p.source_id),
			);

			if (newPoints.length > 0) {
				const { data: insertedData, error: pointsError } =
					await supabaseServiceRole
						.from("leaderboard_points")
						.insert(newPoints)
						.select();

				if (pointsError) {
					console.error("Error inserting leaderboard points:", pointsError);
					// Don't fail the settlement - points can be recalculated later
				} else {
					insertedPoints = insertedData?.length || 0;
				}
			}
		}

		const totalPointsAwarded = leaderboardPoints.reduce(
			(sum, p) => sum + p.points,
			0,
		);

		const response: ApiResponse<{
			poll_id: string;
			asset_symbol: string;
			poll_date: string;
			target_price: number;
			votes_processed: number;
			votes_updated: number;
			points_awarded: number;
			leaderboard_entries_created: number;
			settlement_time: string;
		}> = {
			data: {
				poll_id: poll.id,
				asset_symbol: poll.asset_symbol,
				poll_date: poll.poll_date,
				target_price: target_price,
				votes_processed: votes?.length || 0,
				votes_updated: updatedVotes,
				points_awarded: totalPointsAwarded,
				leaderboard_entries_created: insertedPoints,
				settlement_time: new Date().toISOString(),
			},
			message: "Poll settled successfully",
		};

		res.json(response);
	} catch (error) {
		console.error("Settle poll error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/polls/daily/auto-create - Auto-create polls (cron only)
router.post("/daily/auto-create", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult?.status || 500)
				.json({ error: authResult.error });
		}

		if (!validateAutoCreatePollRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: date (YYYY-MM-DD), assets (array of 'BMNR' | 'ETH-USD')",
			});
		}

		const { date, assets } = req.body;
		const createdPolls = [];
		const errors = [];

		for (const asset of assets) {
			try {
				// Set default step sizes based on asset
				const defaultStepSize = asset === "BMNR" ? 0.01 : 1.0;
				const defaultMaxPoints = 100;

				// Calculate market hours
				const marketHours = calculateMarketHours(date);

				// Create daily poll
				const { data: poll, error } = await supabaseServiceRole
					.from("daily_polls")
					.insert({
						asset_symbol: asset,
						poll_date: date,
						step_size: defaultStepSize,
						max_points: defaultMaxPoints,
						market_open_time: marketHours.marketOpen,
						market_close_time: marketHours.marketClose,
						cutoff_time: marketHours.cutoffTime,
						early_bonus_cutoff: marketHours.earlyBonusCutoff,
					})
					.select()
					.single();

				if (error) {
					if (error.code === "23505") {
						// Unique constraint violation - poll already exists
						errors.push(`Poll already exists for ${asset} on ${date}`);
					} else {
						errors.push(`Failed to create poll for ${asset}: ${error.message}`);
					}
				} else {
					createdPolls.push(poll);
				}
			} catch (error) {
				errors.push(
					`Error creating poll for ${asset}: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		const response: ApiResponse<{
			date: string;
			created_polls: DailyPoll[];
			errors: string[];
			total_created: number;
			total_errors: number;
		}> = {
			data: {
				date,
				created_polls: createdPolls,
				errors,
				total_created: createdPolls.length,
				total_errors: errors.length,
			},
			message: `Auto-creation completed: ${createdPolls.length} polls created, ${errors.length} errors`,
		};

		res.json(response);
	} catch (error) {
		console.error("Auto-create polls error:", error);
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/polls/daily/auto-settle - Auto-settle polls (cron only)
router.post("/daily/auto-settle", async (req: Request, res: Response) => {
	try {
		const authResult = requireCronAuth(req);
		if ("error" in authResult) {
			return res
				.status(authResult?.status || 500)
				.json({ error: authResult.error });
		}

		if (!validateAutoSettlePollRequest(req.body)) {
			return res.status(400).json({
				error:
					"Invalid request. Required: asset_symbol ('BMNR' | 'SBET' | 'ETH-USD'), poll_date (YYYY-MM-DD), target_price (number > 0)",
			});
		}

		const { asset_symbol, poll_date, target_price } = req.body;

		// Find the open poll for this asset and date
		const { data: poll, error: pollError } = await supabaseServiceRole
			.from("daily_polls")
			.select("*")
			.eq("asset_symbol", asset_symbol)
			.eq("poll_date", poll_date)
			.eq("status", "open")
			.single();

		if (pollError || !poll) {
			return res.status(404).json({
				error: "Open poll not found",
				details: `No open poll found for ${asset_symbol} on ${poll_date}`,
			});
		}

		// Update poll with target price and settled status
		const { error: updateError } = await supabaseServiceRole
			.from("daily_polls")
			.update({
				target_price,
				status: "settled",
			})
			.eq("id", poll.id);

		if (updateError) {
			console.error("Error updating poll:", updateError);
			return res.status(500).json({ error: "Failed to update poll" });
		}

		// Get all votes for this poll
		const { data: votes, error: votesError } = await supabaseServiceRole
			.from("daily_poll_votes")
			.select("*")
			.eq("poll_id", poll.id);

		if (votesError) {
			console.error("Error fetching votes:", votesError);
			return res.status(500).json({ error: "Failed to fetch votes" });
		}

		// Calculate points for each vote and update
		const pointsUpdates = [];
		const leaderboardPoints = [];

		for (const vote of votes || []) {
			// Calculate base points using accuracy formula
			const stepDifference =
				Math.abs(target_price - vote.predicted_price) / poll.step_size;
			const basePoints = Math.max(
				0,
				Math.floor(poll.max_points - stepDifference),
			);

			// Apply 2x bonus for early predictions
			const finalPoints = vote.early_bonus_applied
				? basePoints * 2
				: basePoints;

			pointsUpdates.push({
				id: vote.id,
				points_earned: finalPoints,
			});

			if (finalPoints > 0) {
				leaderboardPoints.push({
					user_id: vote.user_id,
					point_type: "daily_poll",
					points: finalPoints,
					source_id: vote.id,
					awarded_date: poll.poll_date,
				});
			}
		}

		// Update vote records with points earned
		let updatedVotes = 0;
		if (pointsUpdates.length > 0) {
			for (const update of pointsUpdates) {
				const { error: updateVoteError } = await supabaseServiceRole
					.from("daily_poll_votes")
					.update({ points_earned: update.points_earned })
					.eq("id", update.id);

				if (updateVoteError) {
					console.error("Error updating vote points:", updateVoteError);
					// Continue with other updates
				} else {
					updatedVotes++;
				}
			}
		}

		// Insert leaderboard points
		let insertedPoints = 0;
		if (leaderboardPoints.length > 0) {
			// Check if leaderboard points already exist for this poll to avoid duplicates
			const { data: existingPoints } = await supabaseServiceRole
				.from("leaderboard_points")
				.select("source_id")
				.in(
					"source_id",
					pointsUpdates.map((p) => p.id),
				);

			const existingSourceIds = new Set(
				existingPoints?.map((p) => p.source_id) || [],
			);
			const newPoints = leaderboardPoints.filter(
				(p) => !existingSourceIds.has(p.source_id),
			);

			if (newPoints.length > 0) {
				const { data: insertedData, error: pointsError } =
					await supabaseServiceRole
						.from("leaderboard_points")
						.insert(newPoints)
						.select();

				if (pointsError) {
					console.error("Error inserting leaderboard points:", pointsError);
					// Don't fail the settlement - points can be recalculated later
				} else {
					insertedPoints = insertedData?.length || 0;
				}
			}
		}

		const totalPointsAwarded = leaderboardPoints.reduce(
			(sum, p) => sum + p.points,
			0,
		);

		const response: ApiResponse<{
			poll_id: string;
			asset_symbol: string;
			poll_date: string;
			target_price: number;
			votes_processed: number;
			votes_updated: number;
			points_awarded: number;
			leaderboard_entries_created: number;
			settlement_time: string;
		}> = {
			data: {
				poll_id: poll.id,
				asset_symbol: poll.asset_symbol,
				poll_date: poll.poll_date,
				target_price: target_price,
				votes_processed: votes?.length || 0,
				votes_updated: updatedVotes,
				points_awarded: totalPointsAwarded,
				leaderboard_entries_created: insertedPoints,
				settlement_time: new Date().toISOString(),
			},
			message: "Poll settled successfully via auto-settlement",
		};

		res.json(response);
	} catch (error) {
		console.error("Auto-settle polls error:", error);
		res.status(500).json(handleDbError(error));
	}
});

export default router;
