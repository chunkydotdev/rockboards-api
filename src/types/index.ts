export interface Company {
	id: string;
	name: string;
	ticker: string;
	website?: string;
	created_at: string;
}

export interface CompanyMetrics {
	id: string;
	company_id: string;
	date: string;
	eth_holdings?: number;
	avg_buy_price?: number;
	usd_holdings?: number;
	staking_rewards?: number;
	shares_outstanding?: number;
	market_cap?: number;
	eth_concentration?: number;
	issued_atm_shares?: number;
	notes?: string;
}

export interface DateMetric<T> {
	value: T;
	date: string;
	companyId: string;
}

export interface NavMetric {
	companyId: string;
	date: string;
	navPerShare: number; // ethConcentration * ethHoldings / sharesOutstanding
	stockPrice: number; // database
	ethPrice: number; // database
	mNav: number; // totalNavValue / marketCap (mNav = 1 is no premium/discount)
	totalNavValue: number; // ethPrice * ethHoldings
}

export interface CompanyMetric {
	weightedAvgBuyPrice: number;
	companyId: string;
	date: string;
	ethHoldings: number; // database + post-fill
	avgBuyPrice: number; // database + post-fill
	usdHoldings: number; // database + post-fill
	stakingRewards: number; // database + post-fill
	sharesOutstanding: number; // ethConcentration * ethHoldings
	marketCap: number; // sharesOutstanding * stockPrice
	ethConcentration: number; // database + post-fill
	issuedAtmShares: number; // calc from sharesOutstanding and later dates
	notes: string; // database
}

export interface StockPrice {
	id: string;
	company_id: string;
	date: string;
	open?: number;
	high?: number;
	low?: number;
	close?: number;
	volume?: number;
}

export interface Event {
	id: string;
	company_id: string;
	date: string;
	title: string;
	description?: string;
	source_url?: string;
}

// Real-time stock price from Yahoo Finance
export interface RealtimeStockPrice {
	ticker: string;
	price: number;
	currency: string;
	regularMarketPrice: number;
	regularMarketChange: number;
	regularMarketChangePercent: number;
	regularMarketTime: string;
	regularMarketPreviousClose: number;
	regularMarketOpen: number;
	regularMarketDayLow: number;
	regularMarketDayHigh: number;
	regularMarketVolume: number;
	marketState: string;
	exchangeName: string;
	fullExchangeName: string;
	displayName: string;
	longName: string;
	preMarketPrice: number;
	preMarketChange: number;
	preMarketChangePercent: number;
	preMarketTime: string;
	postMarketPrice: number;
	postMarketChange: number;
	postMarketChangePercent: number;
	postMarketTime: string;
}

// NAV Calculations
export interface NAVData {
	date: string;
	navPerShare: number;
	stockPrice: number;
	ethPrice: number;
	premiumDiscount: number; // Percentage premium (+) or discount (-) to NAV
	premiumDiscountAmount: number; // Dollar amount
	totalNavValue: number;
	marketCap: number;
	ethConcentration: number;
	ethAmount: number;
	usdAmount: number;
}

// Response types for API routes
export interface CompanyWithData extends Company {
	company_metrics?: CompanyMetrics[];
	stock_prices?: StockPrice[];
	events?: Event[];
}

export interface ApiResponse<T> {
	data: T;
	error?: string;
	message?: string;
}

// Legacy type for backward compatibility
export interface EthHolding extends CompanyMetrics {
	usd_value?: number; // Maps to usd_amount for compatibility
}

// Options data interfaces
export interface OptionsData {
	underlyingSymbol: string;
	expirationDates: Date[];
	strikes: number[];
	hasMiniOptions: boolean;
	quote: {
		underlyingSymbol: string;
		currency: string;
		regularMarketTime: Date;
		lastMarket: string;
		lastPrice: number;
		change: number;
		percentChange: number;
		volume: number;
		openInterest: number;
		bid: number;
		ask: number;
	};
	options: Array<{
		expirationDate: Date;
		hasMiniOptions: boolean;
		calls: Array<{
			contractSymbol: string;
			strike: number;
			currency: string;
			lastPrice: number;
			change: number;
			percentChange: number;
			volume: number;
			openInterest: number;
			bid: number;
			ask: number;
			contractSize: string;
			expiration: Date;
			lastTradeDate: Date;
			impliedVolatility: number;
			inTheMoney: boolean;
		}>;
		puts: Array<{
			contractSymbol: string;
			strike: number;
			currency: string;
			lastPrice: number;
			change: number;
			percentChange: number;
			volume: number;
			openInterest: number;
			bid: number;
			ask: number;
			contractSize: string;
			expiration: Date;
			lastTradeDate: Date;
			impliedVolatility: number;
			inTheMoney: boolean;
		}>;
	}>;
}

export interface ProcessedOptionsData {
	ticker: string;
	impliedVolatility: number | null;
	putCallRatio: number | null;
	totalCallVolume: number;
	totalPutVolume: number;
	totalCallOpenInterest: number;
	totalPutOpenInterest: number;
	optionsCount: {
		calls: number;
		puts: number;
		total: number;
	};
	expirationDates: string[];
	lastUpdated: string;
}

// Moonshot Investment Types
export interface MoonshotInvestment {
	id: string;
	company_id: string;
	ticker: string;
	company_name: string;
	purchase_date: string;
	shares_purchased: number;
	shares_remaining: number; // Current shares held (after any sales)
	purchase_price_per_share: number;
	total_cost: number; // Original total cost of shares_purchased
	current_price?: number; // Real-time price per share
	current_value?: number; // shares_remaining * current_price
	investment_thesis?: string;
	status: "active" | "sold" | "partial_sale";
	created_at: string;
	updated_at: string;
	
	// Calculated fields (for UI)
	shares_sold?: number; // shares_purchased - shares_remaining
	remaining_cost_basis?: number; // (shares_remaining / shares_purchased) * total_cost
	unrealized_gain_loss?: number; // current_value - remaining_cost_basis
	unrealized_gain_loss_percent?: number;
}

export interface MoonshotPortfolio {
	totalInvestments: number;
	totalCostBasis: number;
	totalCurrentValue: number;
	totalUnrealizedGainLoss: number;
	totalUnrealizedGainLossPercent: number;
	investments: MoonshotInvestment[];
	allocationPercentOfTreasury: number;
}

export interface MoonshotTransaction {
	id: string;
	investment_id: string;
	transaction_type: "buy" | "sell";
	transaction_date: string;
	shares: number;
	price_per_share: number;
	total_amount: number;
	fees?: number;
	notes?: string;
	created_at: string;
}