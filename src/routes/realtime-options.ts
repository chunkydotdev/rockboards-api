import { type Request, type Response, Router } from "express";
import yahooFinance from "yahoo-finance2";
import { handleDbError } from "../lib/supabase";
import type { ApiResponse, OptionsData, ProcessedOptionsData } from "../types";

const router: Router = Router();

// GET /api/options/realtime/:ticker - Get real-time options data for specific ticker
router.get("/:ticker", async (req: Request, res: Response) => {
	try {
		const { ticker } = req.params;
		const { date: expirationDate } = req.query;

		if (!ticker) {
			return res.status(400).json({
				error: "Ticker parameter is required",
			});
		}

		// Set up query options
		const queryOptions = {
			lang: "en-US" as const,
			formatted: false,
			region: "US" as const,
			...(expirationDate && { date: new Date(expirationDate as string) }),
		};

		// Fetch options data from Yahoo Finance
		const optionsData = (await yahooFinance.options(
			ticker.toUpperCase(),
			queryOptions,
		)) as unknown as OptionsData;

		if (
			!optionsData ||
			!optionsData.options ||
			optionsData.options.length === 0
		) {
			return res.json({
				data: {
					ticker: ticker.toUpperCase(),
					impliedVolatility: null,
					putCallRatio: null,
					totalCallVolume: 0,
					totalPutVolume: 0,
					totalCallOpenInterest: 0,
					totalPutOpenInterest: 0,
					optionsCount: { calls: 0, puts: 0, total: 0 },
					expirationDates: [],
					lastUpdated: new Date().toISOString(),
				},
				message: "No options data available for this ticker",
			});
		}

		// Process options data to calculate metrics (same logic as base options endpoint)
		let totalCallVolume = 0;
		let totalPutVolume = 0;
		let totalCallOpenInterest = 0;
		let totalPutOpenInterest = 0;
		let totalIV = 0;
		let ivCount = 0;
		let totalCalls = 0;
		let totalPuts = 0;

		for (const expiration of optionsData.options) {
			for (const call of expiration.calls || []) {
				totalCallVolume += call.volume || 0;
				totalCallOpenInterest += call.openInterest || 0;
				if (call.impliedVolatility && call.impliedVolatility > 0) {
					totalIV += call.impliedVolatility;
					ivCount++;
				}
				totalCalls++;
			}

			for (const put of expiration.puts || []) {
				totalPutVolume += put.volume || 0;
				totalPutOpenInterest += put.openInterest || 0;
				if (put.impliedVolatility && put.impliedVolatility > 0) {
					totalIV += put.impliedVolatility;
					ivCount++;
				}
				totalPuts++;
			}
		}

		// Calculate metrics
		const averageIV = ivCount > 0 ? (totalIV / ivCount) * 100 : null; // Convert to percentage
		const useOI = totalCallVolume + totalPutVolume < 100;
		const putCallRatio = useOI
			? totalCallOpenInterest > 0
				? totalPutOpenInterest / totalCallOpenInterest
				: null
			: totalCallVolume > 0
				? totalPutVolume / totalCallVolume
				: null;

		const processedData: ProcessedOptionsData = {
			ticker: ticker.toUpperCase(),
			impliedVolatility: averageIV,
			putCallRatio: putCallRatio,
			totalCallVolume,
			totalPutVolume,
			totalCallOpenInterest,
			totalPutOpenInterest,
			optionsCount: {
				calls: totalCalls,
				puts: totalPuts,
				total: totalCalls + totalPuts,
			},
			expirationDates: optionsData.expirationDates.map((date) =>
				date.toISOString(),
			),
			lastUpdated: new Date().toISOString(),
		};

		const response: ApiResponse<ProcessedOptionsData> = {
			data: processedData,
		};

		// Add cache headers for real-time data (cache for 30 seconds)
		res.set({
			"Cache-Control": "public, max-age=30, stale-while-revalidate=15",
		});

		res.json(response);
	} catch (error) {
		console.error("Error fetching real-time options data:", error);
		res.status(500).json(handleDbError(error));
	}
});

export default router;
