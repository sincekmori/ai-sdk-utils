import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Generates the ai-sdk-catalog configuration reference pages (English + 日本語)
// from packages/catalog/schema.json, so the docs never drift from the shipped
// schema. Field descriptions live next to this script: descriptions.en.json is
// the source of truth; descriptions.ja.json overrides the translated subset,
// and any untranslated field falls back to English. The output pages are
// gitignored and rebuilt by `pnpm dev` / `pnpm build` / `pnpm typecheck`.

interface SchemaNode {
	$defs?: Record<string, SchemaNode>;
	$ref?: string;
	additionalProperties?: SchemaNode | boolean;
	anyOf?: SchemaNode[];
	enum?: string[];
	items?: SchemaNode;
	properties?: Record<string, SchemaNode>;
	required?: string[];
	type?: string;
}

interface Locale {
	allowedValues: string;
	arrayOf: (inner: string) => string;
	columns: [string, string, string, string];
	descriptions: Record<string, string>[];
	generatedNote: string;
	intro: string;
	jsonObject: string;
	jsonValue: string;
	mapOf: (inner: string) => string;
	outFile: string;
	pageDescription: string;
	sameProperties: (path: string) => string;
	seeBelow: (path: string) => string;
	title: string;
	topLevelHeading: string;
}

const scriptsDir = import.meta.dirname;
const repoRoot = join(scriptsDir, "..", "..");
const contentDir = join(scriptsDir, "..", "src", "content", "docs");

const schemaUrl =
	"https://github.com/sincekmori/ai-sdk-utils/blob/main/packages/catalog/schema.json";

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

const root = await readJson<SchemaNode>(join(repoRoot, "packages", "catalog", "schema.json"));
const en = await readJson<Record<string, string>>(join(scriptsDir, "descriptions.en.json"));
const ja = await readJson<Record<string, string>>(join(scriptsDir, "descriptions.ja.json"));

/** Follows a `$ref` into `$defs` (single level — the schema has no ref chains). */
function resolve(node: SchemaNode): SchemaNode {
	if (node.$ref === undefined) {
		return node;
	}
	const name = node.$ref.split("/").at(-1) ?? "";
	const def = root.$defs?.[name];
	if (def === undefined) {
		throw new Error(`Unresolvable $ref: ${node.$ref}`);
	}
	return def;
}

/** The schema encodes "any JSON value" as an `anyOf` over the primitive types. */
function isJsonValue(node: SchemaNode): boolean {
	const types = new Set((node.anyOf ?? []).map((entry) => entry.type));
	return types.has("string") && types.has("number") && types.has("boolean") && types.has("null");
}

function objectValues(node: SchemaNode): SchemaNode | undefined {
	const values = node.additionalProperties;
	return typeof values === "object" ? values : undefined;
}

function typeLabel(rawNode: SchemaNode, locale: Locale): string {
	const node = resolve(rawNode);
	if (isJsonValue(node)) {
		return locale.jsonValue;
	}
	if (node.enum !== undefined) {
		return "enum";
	}
	// A non-JSON-value union (e.g. a header value: string / { envVarName }).
	if (node.anyOf !== undefined) {
		return node.anyOf.map((entry) => typeLabel(entry, locale)).join(" / ");
	}
	if (node.type === "array") {
		return node.items === undefined ? "array" : locale.arrayOf(typeLabel(node.items, locale));
	}
	if (node.type === "object" && node.properties === undefined) {
		const values = objectValues(node);
		if (values !== undefined) {
			const resolved = resolve(values);
			return isJsonValue(resolved) ? locale.jsonObject : locale.mapOf(typeLabel(values, locale));
		}
	}
	return node.type ?? "unknown";
}

/** Lookup keys for a field path, from most to least specific. */
function candidateKeys(path: string): string[] {
	const keys = [path];
	const wildcardBackend = path.replace(/\.backends\.[^.]+/u, ".backends.*");
	if (wildcardBackend !== path) {
		keys.push(wildcardBackend);
	}
	const providerSettings = path.replace("providers[].models[].settings.", "providers[].settings.");
	if (providerSettings !== path) {
		keys.push(providerSettings);
	}
	return keys;
}

function descriptionFor(path: string, locale: Locale): string {
	for (const map of locale.descriptions) {
		for (const key of candidateKeys(path)) {
			const text = map[key];
			if (text !== undefined) {
				return text;
			}
		}
	}
	return "";
}

// ---------------------------------------------------------------------------
// Collect one documentation section per object-with-properties in the schema,
// in depth-first order so parents precede their children.

interface Section {
	node: SchemaNode;
	path: string;
}

const sections: Section[] = [];

function visit(rawNode: SchemaNode, path: string): void {
	const node = resolve(rawNode);
	if (isJsonValue(node)) {
		return;
	}
	if (node.type === "array" && node.items !== undefined) {
		visit(node.items, `${path}[]`);
		return;
	}
	if (node.type !== "object") {
		return;
	}
	if (node.properties !== undefined) {
		sections.push({ node, path });
		for (const [key, child] of Object.entries(node.properties)) {
			visit(child, path === "" ? key : `${path}.${key}`);
		}
		return;
	}
	const values = objectValues(node);
	if (values !== undefined) {
		visit(values, `${path}.*`);
	}
}

visit(root, "");

const sectionPaths = new Set(sections.map((section) => section.path));

/** The section documenting a table row's value type, if one exists. */
function childSection(path: string): string | undefined {
	return [path, `${path}[]`, `${path}.*`].find((candidate) => sectionPaths.has(candidate));
}

// ---------------------------------------------------------------------------
// Rendering.

function escapeCell(text: string): string {
	return text.replaceAll("|", String.raw`\|`);
}

function renderRow(section: Section, entry: [string, SchemaNode], locale: Locale): string {
	const [key, child] = entry;
	const childPath = section.path === "" ? key : `${section.path}.${key}`;
	let description = descriptionFor(childPath, locale);
	const resolved = resolve(child);
	if (resolved.enum !== undefined) {
		const values = resolved.enum.map((value) => `\`${value}\``).join(", ");
		description = `${description} ${locale.allowedValues} ${values}.`.trim();
	}
	const target = childSection(childPath);
	if (target !== undefined) {
		description = `${description} ${locale.seeBelow(target)}`.trim();
	}
	const required = section.node.required?.includes(key) === true ? "✓" : "";
	const cells = [
		`\`${key}\``,
		`\`${typeLabel(child, locale)}\``,
		required,
		escapeCell(description),
	];
	return `| ${cells.join(" | ")} |`;
}

function renderSection(section: Section, locale: Locale, rendered: Map<string, string>): string[] {
	const heading = section.path === "" ? `## ${locale.topLevelHeading}` : `## \`${section.path}\``;
	const intro = descriptionFor(section.path, locale);
	const lines = [heading, "", ...(intro === "" ? [] : [intro, ""])];

	// Identically-shaped objects (the fixed-path gateway backends, model-level
	// settings) are documented once and referenced afterwards.
	const shape = JSON.stringify(section.node);
	const original = rendered.get(shape);
	if (original !== undefined) {
		return [...lines, locale.sameProperties(original), ""];
	}
	rendered.set(shape, section.path);

	const rows = Object.entries(section.node.properties ?? {}).map((entry) =>
		renderRow(section, entry, locale),
	);
	return [...lines, `| ${locale.columns.join(" | ")} |`, "| --- | --- | --- | --- |", ...rows, ""];
}

function renderPage(locale: Locale): string {
	const rendered = new Map<string, string>();
	const lines = [
		"---",
		`title: ${locale.title}`,
		`description: ${locale.pageDescription}`,
		"---",
		"",
		"{/* GENERATED FILE - DO NOT EDIT. Run `pnpm --filter docs generate-reference`. */}",
		"",
		":::note",
		locale.generatedNote,
		":::",
		"",
		locale.intro,
		"",
		...sections.flatMap((section) => renderSection(section, locale, rendered)),
	];
	return `${lines.join("\n").trimEnd()}\n`;
}

const locales: Locale[] = [
	{
		allowedValues: "Allowed values:",
		arrayOf: (inner) => `array of ${inner}`,
		columns: ["Property", "Type", "Required", "Description"],
		descriptions: [en],
		generatedNote:
			`This page is generated at build time from [\`schema.json\`](${schemaUrl}), ` +
			"the JSON Schema shipped with the `ai-sdk-catalog` package, so it always matches the released schema.",
		intro:
			"Every field of the `ai-sdk-catalog` configuration file. " +
			"Paths use `[]` for array entries and `*` for arbitrary map keys.",
		jsonObject: "JSON object",
		jsonValue: "JSON value",
		mapOf: (inner) => `map of ${inner}`,
		outFile: join(contentDir, "catalog", "reference.mdx"),
		pageDescription:
			"Every field of the ai-sdk-catalog configuration file, generated from schema.json.",
		sameProperties: (path) => `Same properties as \`${path}\` above.`,
		seeBelow: (path) => `See \`${path}\` below.`,
		title: "Configuration reference",
		topLevelHeading: "Top-level fields",
	},
	{
		allowedValues: "指定できる値:",
		arrayOf: (inner) => `${inner} の配列`,
		columns: ["プロパティ", "型", "必須", "説明"],
		descriptions: [ja, en],
		generatedNote:
			`このページは、\`ai-sdk-catalog\` パッケージに同梱される JSON Schema([\`schema.json\`](${schemaUrl}))` +
			"からビルド時に生成されるため、常にリリース済みスキーマと一致します。",
		intro:
			"`ai-sdk-catalog` 設定ファイルの全フィールドの一覧です。" +
			"パス表記では、配列の要素を `[]`、任意のマップキーを `*` で表します。",
		jsonObject: "JSON オブジェクト",
		jsonValue: "JSON 値",
		mapOf: (inner) => `${inner} のマップ`,
		outFile: join(contentDir, "ja", "catalog", "reference.mdx"),
		pageDescription: "schema.json から生成された ai-sdk-catalog 設定ファイルの全フィールド。",
		sameProperties: (path) => `プロパティは上記の \`${path}\` と同じです。`,
		seeBelow: (path) => `詳細は後述の \`${path}\` を参照。`,
		title: "設定リファレンス",
		topLevelHeading: "トップレベルのフィールド",
	},
];

await Promise.all(
	locales.map(async (locale) => {
		await mkdir(dirname(locale.outFile), { recursive: true });
		await writeFile(locale.outFile, renderPage(locale));
		console.log(`wrote ${locale.outFile}`);
	}),
);
