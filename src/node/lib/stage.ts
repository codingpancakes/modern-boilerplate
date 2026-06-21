function normalizeStage(stage: string | undefined): string {
	return (stage ?? "").trim().toLowerCase();
}

export function isDeployedStage(stage = process.env.STAGE): boolean {
	const normalized = normalizeStage(stage);
	return normalized === "production" || normalized === "staging";
}

export function isLocalDevelopmentStage(stage = process.env.STAGE): boolean {
	const normalized = normalizeStage(stage);
	return normalized === "local" || normalized === "development";
}

export function isDevLikeStage(stage = process.env.STAGE): boolean {
	return !isDeployedStage(stage);
}
