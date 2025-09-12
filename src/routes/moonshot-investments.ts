import { type Request, type Response, Router } from "express";
import { handleDbError, supabaseServiceRole as supabase } from "../lib/supabase";
import type { ApiResponse, MoonshotInvestment, MoonshotPortfolio } from "../types";
import yahooFinance from "yahoo-finance2";

const router: Router = Router();

// GET /api/moonshot-investments - Get all moonshot investments with portfolio summary
router.get("/", async (req: Request, res: Response) => {
	try {
		// Fetch all investments with company data
		const { data: investments, error } = await supabase
			.from("moonshot_investments")
			.select(`
				*,
				companies!inner(ticker, name)
			`)
			.order("purchase_date", { ascending: false });

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		if (!investments || investments.length === 0) {
			const response: ApiResponse<MoonshotPortfolio> = {
				data: {
					totalInvestments: 0,
					totalCostBasis: 0,
					totalCurrentValue: 0,
					totalUnrealizedGainLoss: 0,
					totalUnrealizedGainLossPercent: 0,
					investments: [],
					allocationPercentOfTreasury: 0,
				},
			};
			return res.json(response);
		}

		// Fetch real-time prices for all unique tickers
		const uniqueTickers = [...new Set(investments.map(inv => inv.ticker))];
		const pricePromises = uniqueTickers.map(async (ticker) => {
			try {
				const quote = await yahooFinance.quote(ticker);
				return {
					ticker,
					price: (quote as any)?.regularMarketPrice || 0,
				};
			} catch (error) {
				console.warn(`Failed to fetch price for ${ticker}:`, error);
				return { ticker, price: 0 };
			}
		});

		const prices = await Promise.all(pricePromises);
		const priceMap = new Map(prices.map(p => [p.ticker, p.price]));

		// Calculate portfolio metrics
		let totalCostBasis = 0;
		let totalCurrentValue = 0;

		const enrichedInvestments: MoonshotInvestment[] = investments.map(inv => {
			const currentPrice = priceMap.get(inv.ticker) || 0;
			const currentValue = inv.shares_remaining * currentPrice;
			const remainingCostBasis = (inv.shares_remaining / inv.shares_purchased) * inv.total_cost;
			const unrealizedGainLoss = currentValue - remainingCostBasis;
			const unrealizedGainLossPercent = remainingCostBasis > 0 
				? (unrealizedGainLoss / remainingCostBasis) * 100 
				: 0;

			totalCostBasis += remainingCostBasis;
			totalCurrentValue += currentValue;

			return {
				...inv,
				company_name: inv.companies.name,
				current_price: currentPrice,
				current_value: currentValue,
				shares_sold: inv.shares_purchased - inv.shares_remaining,
				remaining_cost_basis: remainingCostBasis,
				unrealized_gain_loss: unrealizedGainLoss,
				unrealized_gain_loss_percent: unrealizedGainLossPercent,
			};
		});

		const totalUnrealizedGainLoss = totalCurrentValue - totalCostBasis;
		const totalUnrealizedGainLossPercent = totalCostBasis > 0 
			? (totalUnrealizedGainLoss / totalCostBasis) * 100 
			: 0;

		const portfolio: MoonshotPortfolio = {
			totalInvestments: investments.length,
			totalCostBasis,
			totalCurrentValue,
			totalUnrealizedGainLoss,
			totalUnrealizedGainLossPercent,
			investments: enrichedInvestments,
			allocationPercentOfTreasury: 0, // This would need treasury data to calculate
		};

		const response: ApiResponse<MoonshotPortfolio> = {
			data: portfolio,
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/moonshot-investments - Create new moonshot investment
router.post("/", async (req: Request, res: Response) => {
	try {
		const {
			company_id,
			ticker,
			purchase_date,
			shares_purchased,
			purchase_price_per_share,
			investment_thesis,
		} = req.body;

		// Validate required fields
		if (!company_id || !ticker || !purchase_date || !shares_purchased || !purchase_price_per_share) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "company_id, ticker, purchase_date, shares_purchased, and purchase_price_per_share are required",
			});
		}

		// Validate numeric fields
		if (shares_purchased <= 0 || purchase_price_per_share <= 0) {
			return res.status(400).json({
				error: "Invalid numeric values",
				message: "shares_purchased and purchase_price_per_share must be positive numbers",
			});
		}

		// Calculate total cost
		const total_cost = shares_purchased * purchase_price_per_share;

		// Fetch company name for the investment
		const { data: company, error: companyError } = await supabase
			.from("companies")
			.select("name")
			.eq("id", company_id)
			.single();

		if (companyError) {
			return res.status(400).json({
				error: "Invalid company_id",
				message: "Company not found",
			});
		}

		// Insert new investment
		const { data: investment, error } = await supabase
			.from("moonshot_investments")
			.insert({
				company_id,
				ticker: ticker.toUpperCase(),
				company_name: company.name,
				purchase_date,
				shares_purchased,
				shares_remaining: shares_purchased, // Initially all shares remain
				purchase_price_per_share,
				total_cost,
				investment_thesis,
				status: "active",
			})
			.select()
			.single();

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		// Fetch current price for the new investment
		try {
			const quote = await yahooFinance.quote(ticker);
			const currentPrice = (quote as any)?.regularMarketPrice || 0;
			const currentValue = investment.shares_remaining * currentPrice;
			const unrealizedGainLoss = currentValue - investment.total_cost;
			const unrealizedGainLossPercent = investment.total_cost > 0 
				? (unrealizedGainLoss / investment.total_cost) * 100 
				: 0;

			const enrichedInvestment: MoonshotInvestment = {
				...investment,
				current_price: currentPrice,
				current_value: currentValue,
				shares_sold: 0,
				remaining_cost_basis: investment.total_cost,
				unrealized_gain_loss: unrealizedGainLoss,
				unrealized_gain_loss_percent: unrealizedGainLossPercent,
			};

			const response: ApiResponse<MoonshotInvestment> = {
				data: enrichedInvestment,
				message: "Moonshot investment created successfully",
			};

			res.status(201).json(response);
		} catch (priceError) {
			console.warn(`Failed to fetch current price for ${ticker}:`, priceError);
			
			// Return investment without real-time pricing
			const response: ApiResponse<MoonshotInvestment> = {
				data: {
					...investment,
					current_price: 0,
					current_value: 0,
					shares_sold: 0,
					remaining_cost_basis: investment.total_cost,
					unrealized_gain_loss: -investment.total_cost,
					unrealized_gain_loss_percent: -100,
				},
				message: "Moonshot investment created successfully (real-time pricing unavailable)",
			};

			res.status(201).json(response);
		}
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

export default router;