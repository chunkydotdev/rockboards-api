// Environment variable validation
export function validateEnvironment() {
	const requiredVars = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

	const missingVars = requiredVars.filter((varName) => !process.env[varName]);

	if (missingVars.length > 0) {
		console.error(
			`❌ Missing required environment variables: ${missingVars.join(", ")}`,
		);
		console.error("Please check your .env file or environment configuration");
		process.exit(1);
	}

	// Log configuration (without sensitive data)
	console.log("✅ Environment validation passed");
	console.log(
		`📊 Supabase URL: ${process.env.SUPABASE_URL?.substring(0, 30)}...`,
	);
	console.log(
		`🔑 Service role key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "not configured (using anon key)"}`,
	);

	const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
		"https://bmnr.rocks",
		"https://www.bmnr.rocks",
		"https://sbet.rocks",
		"https://www.sbet.rocks",
		"http://localhost:3000",
		"http://localhost:3001",
	];
	console.log(
		`🌐 Allowed origins: ${allowedOrigins.length} domains configured`,
	);
}
