#!/usr/bin/env node
const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { dirname, relative, resolve } = require("node:path");

const root = process.cwd();
const ignoredDirectories = new Set([
	".git",
	".wrangler",
	"coverage",
	"dist",
	"node_modules",
]);
const repositoryPathPrefixes = [
	"src/",
	"docs/",
	"scripts/",
	"tests/",
	"templates/",
	".github/",
	".cursor/",
];
const repositoryRootFiles = new Set([
	"AGENTS.md",
	"README.md",
	"package.json",
	"pnpm-lock.yaml",
	"tsconfig.json",
	"vitest.config.ts",
	"vitest.integration.config.ts",
	"wrangler.toml",
	".dev.vars.example",
]);
const packageScripts = new Set(
	Object.keys(
		JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts,
	),
);
const pnpmBuiltins = new Set(["add", "audit", "exec", "install", "run"]);

function collectDocumentationFiles(path) {
	const absolute = resolve(root, path);
	if (!existsSync(absolute)) return [];
	if (!statSync(absolute).isDirectory()) return [absolute];
	return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
		const child = resolve(absolute, entry.name);
		if (entry.isDirectory()) return collectDocumentationFiles(child);
		return entry.name.endsWith(".md") || entry.name.endsWith(".mdc")
			? [child]
			: [];
	});
}

function lineNumber(content, offset) {
	return content.slice(0, offset).split("\n").length;
}

function withoutFragmentOrQuery(target) {
	return target.split("#", 1)[0].split("?", 1)[0];
}

function isExternal(target) {
	return (
		target.startsWith("#") ||
		target.startsWith("/") ||
		/^[a-z][a-z0-9+.-]*:/i.test(target)
	);
}

const failures = [];
const files = collectDocumentationFiles(".");

for (const file of files) {
	const content = readFileSync(file, "utf8");

	for (const match of content.matchAll(
		/\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
	)) {
		const target = match[1];
		if (isExternal(target)) continue;
		const localPath = decodeURIComponent(withoutFragmentOrQuery(target));
		if (!localPath) continue;
		if (!existsSync(resolve(dirname(file), localPath))) {
			failures.push(
				`${relative(root, file)}:${lineNumber(content, match.index)} broken link: ${target}`,
			);
		}
	}

	for (const match of content.matchAll(/`([^`\n]+)`/g)) {
		const target = withoutFragmentOrQuery(match[1])
			.replace(/:[0-9]+$/, "")
			.replace(/[.,;:]$/, "");
		const isRepositoryPath =
			repositoryPathPrefixes.some((prefix) => target.startsWith(prefix)) ||
			repositoryRootFiles.has(target);
		if (
			!isRepositoryPath ||
			/[\s*{}<>$|]/.test(target) ||
			target.includes("...")
		) {
			continue;
		}
		if (!existsSync(resolve(root, target))) {
			failures.push(
				`${relative(root, file)}:${lineNumber(content, match.index)} missing referenced path: ${target}`,
			);
		}
	}

	for (const match of content.matchAll(/\bpnpm ([a-zA-Z0-9:_-]+)/g)) {
		const command = match[1];
		if (
			pnpmBuiltins.has(command) ||
			packageScripts.has(command) ||
			command.endsWith(":")
		) {
			continue;
		}
		failures.push(
			`${relative(root, file)}:${lineNumber(content, match.index)} unknown pnpm command: ${command}`,
		);
	}
}

function normalizeRoutePath(prefix, localPath) {
	const joined = `${prefix}/${localPath}`.replace(/\/+/g, "/");
	return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function codeRestOperations() {
	const indexPath = resolve(root, "src/node/routes/index.ts");
	const indexSource = readFileSync(indexPath, "utf8");
	const importFiles = new Map();
	for (const match of indexSource.matchAll(
		/import\s+\{\s*(\w+)\s*\}\s+from\s+"\.\/([^"]+)";/g,
	)) {
		importFiles.set(match[1], match[2]);
	}

	const operations = new Set();
	for (const match of indexSource.matchAll(
		/routes\.route\("([^"]+)",\s*(\w+)\);/g,
	)) {
		const [, prefix, variable] = match;
		const sourceName = importFiles.get(variable);
		if (!sourceName || sourceName === "graphql") continue;
		const source = readFileSync(
			resolve(root, `src/node/routes/${sourceName}.ts`),
			"utf8",
		);
		const routePattern = new RegExp(
			`\\b${variable}\\.(get|post|put|patch|delete)\\("([^"]+)"`,
			"g",
		);
		for (const route of source.matchAll(routePattern)) {
			const method = route[1].toUpperCase();
			const path = normalizeRoutePath(prefix, route[2]).replace(
				/:([A-Za-z0-9_]+)/g,
				"{$1}",
			);
			operations.add(`${method} ${path}`);
		}
	}
	return operations;
}

const openapi = JSON.parse(
	readFileSync(resolve(root, "docs/api/openapi.json"), "utf8"),
);
const documentedOperations = new Set();
const securitySchemes = new Set(
	Object.keys(openapi.components?.securitySchemes ?? {}),
);
for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
	for (const method of ["get", "post", "put", "patch", "delete"]) {
		const operation = pathItem[method];
		if (!operation) continue;
		documentedOperations.add(`${method.toUpperCase()} ${path}`);
		for (const requirement of operation.security ?? []) {
			for (const scheme of Object.keys(requirement)) {
				if (!securitySchemes.has(scheme)) {
					failures.push(
						`docs/api/openapi.json unknown security scheme on ${method.toUpperCase()} ${path}: ${scheme}`,
					);
				}
			}
		}
	}
}

const sourceOperations = codeRestOperations();
for (const operation of sourceOperations) {
	if (!documentedOperations.has(operation)) {
		failures.push(`docs/api/openapi.json missing REST operation: ${operation}`);
	}
}
for (const operation of documentedOperations) {
	if (!sourceOperations.has(operation)) {
		failures.push(
			`docs/api/openapi.json documents no matching REST route: ${operation}`,
		);
	}
}

if (failures.length > 0) {
	console.error("Documentation validation failed:\n");
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(
	`Documentation validation passed (${files.length} Markdown/rule files).`,
);
