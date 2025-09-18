import { type Request, type Response, Router } from "express";
import {
	handleDbError,
	supabaseServiceRole as supabase,
} from "../lib/supabase";
import type {
	AlternativeAsset,
	AlternativeAssetsPortfolio,
	ApiResponse,
} from "../types";

const router: Router = Router();

// GET /api/alternative-assets - Get all alternative assets with portfolio summary
router.get("/", async (req: Request, res: Response) => {
	try {
		// Fetch all alternative assets with company data
		const { data: assets, error } = await supabase
			.from("alternative_assets")
			.select(`
				*,
				companies!inner(ticker, name)
			`)
			.order("purchase_date", { ascending: false });

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		if (!assets || assets.length === 0) {
			const response: ApiResponse<AlternativeAssetsPortfolio> = {
				data: {
					totalAssets: 0,
					totalCostBasis: 0,
					totalCurrentValue: 0,
					totalUnrealizedGainLoss: 0,
					totalUnrealizedGainLossPercent: 0,
					assets: [],
					allocationPercentOfTreasury: 0,
					assetsByCategory: {},
					assetsByType: {},
				},
			};
			return res.json(response);
		}

		// Get current prices from realtime_stock_prices table by ticker
		const tickers = assets.map((asset) => asset.ticker).filter(Boolean);

		// Get prices by ticker (this is the primary key for realtime_stock_prices)
		const { data: realtimePricesByTicker } = await supabase
			.from("realtime_stock_prices")
			.select("ticker, price")
			.in("ticker", tickers);

		// Create price map for current prices (map by ticker)
		const tickerPriceMap = new Map();

		if (realtimePricesByTicker) {
			for (const priceRecord of realtimePricesByTicker) {
				if (priceRecord.ticker) {
					tickerPriceMap.set(priceRecord.ticker, priceRecord.price);
				}
			}
		}

		// Calculate portfolio metrics
		let totalCostBasis = 0;
		let totalCurrentValue = 0;
		const assetsByCategory: Record<string, AlternativeAsset[]> = {};
		const assetsByType: Record<string, AlternativeAsset[]> = {};

		const enrichedAssets: AlternativeAsset[] = assets.map((asset) => {
			// Get current price from realtime_stock_prices by ticker
			const currentPrice = tickerPriceMap.get(asset.ticker) || 0;
			const currentValue = asset.shares_remaining * currentPrice;
			const remainingCostBasis =
				(asset.shares_remaining / asset.shares_purchased) * asset.total_cost;
			const unrealizedGainLoss = currentValue - remainingCostBasis;
			const unrealizedGainLossPercent =
				remainingCostBasis > 0
					? (unrealizedGainLoss / remainingCostBasis) * 100
					: 0;

			totalCostBasis += remainingCostBasis;
			totalCurrentValue += currentValue;

			const enrichedAsset: AlternativeAsset = {
				...asset,
				company_name: asset.companies.name,
				current_price: currentPrice,
				current_value: currentValue,
				shares_sold: asset.shares_purchased - asset.shares_remaining,
				remaining_cost_basis: remainingCostBasis,
				unrealized_gain_loss: unrealizedGainLoss,
				unrealized_gain_loss_percent: unrealizedGainLossPercent,
			};

			// Group by category
			if (!assetsByCategory[asset.asset_category]) {
				assetsByCategory[asset.asset_category] = [];
			}
			assetsByCategory[asset.asset_category].push(enrichedAsset);

			// Group by type
			if (!assetsByType[asset.asset_type]) {
				assetsByType[asset.asset_type] = [];
			}
			assetsByType[asset.asset_type].push(enrichedAsset);

			return enrichedAsset;
		});

		const totalUnrealizedGainLoss = totalCurrentValue - totalCostBasis;
		const totalUnrealizedGainLossPercent =
			totalCostBasis > 0 ? (totalUnrealizedGainLoss / totalCostBasis) * 100 : 0;

		const portfolio: AlternativeAssetsPortfolio = {
			totalAssets: assets.length,
			totalCostBasis,
			totalCurrentValue,
			totalUnrealizedGainLoss,
			totalUnrealizedGainLossPercent,
			assets: enrichedAssets,
			allocationPercentOfTreasury: 0, // This would need treasury data to calculate
			assetsByCategory,
			assetsByType,
		};

		const response: ApiResponse<AlternativeAssetsPortfolio> = {
			data: portfolio,
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/alternative-assets/:id - Get specific alternative asset with transaction history
router.get("/:id", async (req: Request, res: Response) => {
	try {
		const { id } = req.params;

		if (!id) {
			return res.status(400).json({
				error: "Missing asset ID parameter",
				message: "Asset ID is required",
			});
		}

		// Fetch asset with company data
		const { data: asset, error: assetError } = await supabase
			.from("alternative_assets")
			.select(`
				*,
				companies!inner(ticker, name)
			`)
			.eq("id", id)
			.single();

		if (assetError || !asset) {
			return res.status(404).json({
				error: "Asset not found",
				message: `Alternative asset with ID ${id} not found`,
			});
		}

		// Fetch transaction history
		const { data: transactions, error: transactionsError } = await supabase
			.from("alternative_asset_transactions")
			.select("*")
			.eq("asset_id", id)
			.order("transaction_date", { ascending: false });

		if (transactionsError) {
			return res.status(500).json(handleDbError(transactionsError));
		}

		// Get price history from stock_prices table
		const { data: priceHistory, error: priceHistoryError } = await supabase
			.from("stock_prices")
			.select("date, close, open, high, low, volume")
			.eq("company_id", asset.company_id)
			.order("date", { ascending: false })
			.limit(30); // Last 30 price points

		if (priceHistoryError) {
			return res.status(500).json(handleDbError(priceHistoryError));
		}

		// Get current price from realtime_stock_prices
		const { data: realtimePrice } = await supabase
			.from("realtime_stock_prices")
			.select("price")
			.eq("company_id", asset.company_id)
			.single();

		const currentPrice = realtimePrice?.price || 0;
		const currentValue = asset.shares_remaining * currentPrice;
		const remainingCostBasis =
			(asset.shares_remaining / asset.shares_purchased) * asset.total_cost;
		const unrealizedGainLoss = currentValue - remainingCostBasis;
		const unrealizedGainLossPercent =
			remainingCostBasis > 0
				? (unrealizedGainLoss / remainingCostBasis) * 100
				: 0;

		const enrichedAsset: AlternativeAsset = {
			...asset,
			company_name: asset.companies.name,
			current_price: currentPrice,
			current_value: currentValue,
			shares_sold: asset.shares_purchased - asset.shares_remaining,
			remaining_cost_basis: remainingCostBasis,
			unrealized_gain_loss: unrealizedGainLoss,
			unrealized_gain_loss_percent: unrealizedGainLossPercent,
			transactions: transactions || [],
			price_history: priceHistory || [],
		};

		const response: ApiResponse<AlternativeAsset> = {
			data: enrichedAsset,
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

export default router;
