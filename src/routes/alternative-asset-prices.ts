import { type Request, type Response, Router } from "express";
import {
	handleDbError,
	supabaseServiceRole as supabase,
} from "../lib/supabase";
import type { ApiResponse } from "../types";

const router: Router = Router();

// GET /api/alternative-asset-prices/:assetId - Get price history for specific asset
router.get("/:assetId", async (req: Request, res: Response) => {
	try {
		const { assetId } = req.params;
		const { days = "30" } = req.query;

		if (!assetId) {
			return res.status(400).json({
				error: "Missing asset ID parameter",
				message: "Asset ID is required",
			});
		}

		// Validate days parameter
		const daysNum = Number.parseInt(days as string, 10);
		if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
			return res.status(400).json({
				error: "Invalid days parameter",
				message: "Days must be a number between 1 and 365",
			});
		}

		// Verify asset exists and get company_id
		const { data: asset, error: assetError } = await supabase
			.from("alternative_assets")
			.select("id, asset_name, ticker, company_id")
			.eq("id", assetId)
			.single();

		if (assetError || !asset) {
			return res.status(404).json({
				error: "Asset not found",
				message: `Alternative asset with ID ${assetId} not found`,
			});
		}

		// Get price history from stock_prices table
		const { data: prices, error } = await supabase
			.from("stock_prices")
			.select("date, open, high, low, close, volume")
			.eq("company_id", asset.company_id)
			.order("date", { ascending: false })
			.limit(daysNum);

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		// Transform to match expected format
		const transformedPrices = (prices || []).map((price) => ({
			id: `${asset.company_id}-${price.date}`,
			asset_id: assetId,
			date: price.date,
			price: price.close,
			source: "automated" as const,
			created_at: new Date().toISOString(),
			// Include OHLCV data for charts
			open: price.open,
			high: price.high,
			low: price.low,
			volume: price.volume,
		}));

		const response: ApiResponse<typeof transformedPrices> = {
			data: transformedPrices,
			message: `Retrieved ${transformedPrices.length} price records for ${asset.asset_name}`,
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/alternative-asset-prices - Get latest prices for all assets or multiple asset IDs
router.get("/", async (req: Request, res: Response) => {
	try {
		const { assetIds, latest = "true" } = req.query;

		// Get assets first
		let assetQuery = supabase
			.from("alternative_assets")
			.select("id, asset_name, ticker, asset_type, asset_category, company_id");

		// Filter by specific asset IDs if provided
		if (assetIds) {
			const assetIdList = (assetIds as string)
				.split(",")
				.map((id) => id.trim())
				.filter((id) => id.length > 0);

			if (assetIdList.length === 0) {
				return res.status(400).json({
					error: "Invalid assetIds parameter",
					message: "At least one valid asset ID is required",
				});
			}

			assetQuery = assetQuery.in("id", assetIdList);
		}

		const { data: assets, error: assetsError } = await assetQuery;

		if (assetsError) {
			return res.status(500).json(handleDbError(assetsError));
		}

		if (!assets || assets.length === 0) {
			const response: ApiResponse<any[]> = {
				data: [],
				message: "No assets found",
			};
			return res.json(response);
		}

		// Get current prices from realtime_stock_prices for these companies
		const companyIds = assets.map((asset) => asset.company_id);
		const { data: realtimePrices, error: pricesError } = await supabase
			.from("realtime_stock_prices")
			.select("company_id, price, updated_at")
			.in("company_id", companyIds);

		if (pricesError) {
			return res.status(500).json(handleDbError(pricesError));
		}

		// Create map of current prices by company_id
		const currentPricesMap = new Map();
		if (realtimePrices) {
			for (const price of realtimePrices) {
				currentPricesMap.set(price.company_id, price);
			}
		}

		// Combine asset info with current prices
		const enrichedPrices = assets.map((asset) => {
			const currentPrice = currentPricesMap.get(asset.company_id);
			return {
				id: `${asset.company_id}-current`,
				asset_id: asset.id,
				date:
					currentPrice?.updated_at?.split("T")[0] ||
					new Date().toISOString().split("T")[0],
				price: currentPrice?.price || 0,
				source: "realtime" as const,
				created_at: new Date().toISOString(),
				// Include asset info
				alternative_assets: {
					id: asset.id,
					asset_name: asset.asset_name,
					ticker: asset.ticker,
					asset_type: asset.asset_type,
					asset_category: asset.asset_category,
				},
			};
		});

		const response: ApiResponse<typeof enrichedPrices> = {
			data: enrichedPrices,
			message: `Retrieved ${enrichedPrices.length} price records`,
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/alternative-asset-prices/chart/:assetId - Get price history formatted for charts
router.get("/chart/:assetId", async (req: Request, res: Response) => {
	try {
		const { assetId } = req.params;
		const { days = "30", interval = "daily" } = req.query;

		if (!assetId) {
			return res.status(400).json({
				error: "Missing asset ID parameter",
				message: "Asset ID is required",
			});
		}

		// Validate parameters
		const daysNum = Number.parseInt(days as string, 10);
		if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
			return res.status(400).json({
				error: "Invalid days parameter",
				message: "Days must be a number between 1 and 365",
			});
		}

		if (!["daily", "weekly", "monthly"].includes(interval as string)) {
			return res.status(400).json({
				error: "Invalid interval parameter",
				message: "Interval must be 'daily', 'weekly', or 'monthly'",
			});
		}

		// Verify asset exists
		const { data: asset, error: assetError } = await supabase
			.from("alternative_assets")
			.select("id, asset_name, ticker, purchase_price_per_share, company_id")
			.eq("id", assetId)
			.single();

		if (assetError || !asset) {
			return res.status(404).json({
				error: "Asset not found",
				message: `Alternative asset with ID ${assetId} not found`,
			});
		}

		// Fetch price history from stock_prices
		const { data: prices, error } = await supabase
			.from("stock_prices")
			.select("date, close, open, high, low, volume")
			.eq("company_id", asset.company_id)
			.order("date", { ascending: true })
			.limit(daysNum);

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		// Format for chart (simple daily for now, can be enhanced for intervals)
		const chartData = (prices || []).map((price) => ({
			date: price.date,
			price: price.close,
			source: "automated",
			open: price.open,
			high: price.high,
			low: price.low,
			volume: price.volume,
		}));

		// Calculate basic stats
		const priceValues = chartData.map((d) => d.price);
		const minPrice = Math.min(...priceValues);
		const maxPrice = Math.max(...priceValues);
		const firstPrice = priceValues[0] || asset.purchase_price_per_share;
		const lastPrice =
			priceValues[priceValues.length - 1] || asset.purchase_price_per_share;
		const totalReturn =
			firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

		const response: ApiResponse<{
			asset: typeof asset;
			chartData: typeof chartData;
			stats: {
				minPrice: number;
				maxPrice: number;
				firstPrice: number;
				lastPrice: number;
				totalReturn: number;
				dataPoints: number;
			};
		}> = {
			data: {
				asset,
				chartData,
				stats: {
					minPrice,
					maxPrice,
					firstPrice,
					lastPrice,
					totalReturn,
					dataPoints: chartData.length,
				},
			},
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

export default router;
