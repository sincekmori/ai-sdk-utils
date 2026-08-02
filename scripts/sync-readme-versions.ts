import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Rewrites version-pinned npm CDN URLs (".../npm/<package>@<version>/...") in
// each package's README.md to the version currently in its package.json.
// Runs after `changeset version` (see the root "version" script), so the
// release commit updates the pins together with the version bumps. Scoped to
// README.md on purpose: CHANGELOG.md may legitimately mention old versions.

/** Escapes a string for literal use inside a RegExp. */
function escapeRegExp(text: string): string {
	return text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
}

/** The file's text, or undefined when it cannot be read. */
async function readOptional(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
	}
}

/** Syncs one package directory; quietly skips anything that isn't one. */
async function syncPackage(dir: string): Promise<void> {
	const manifest = await readOptional(join(dir, "package.json"));
	const readmePath = join(dir, "README.md");
	const readme = await readOptional(readmePath);
	if (manifest === undefined || readme === undefined) {
		return; // not a package dir, or no README to sync
	}
	const pkg = JSON.parse(manifest) as { name?: string; version?: string; private?: boolean };
	if (pkg.name === undefined || pkg.version === undefined || pkg.private === true) {
		return;
	}
	// "/npm/<name>@1.2.3" with an optional prerelease/build suffix.
	const pin = new RegExp(
		String.raw`(/npm/${escapeRegExp(pkg.name)}@)\d+\.\d+\.\d+(?:[-+][\w.+-]+)?`,
		"gu",
	);
	const synced = readme.replaceAll(pin, `$1${pkg.version}`);
	if (synced !== readme) {
		await writeFile(readmePath, synced);
		console.log(`synced ${pkg.name}@${pkg.version} pins in ${readmePath}`);
	}
}

const packagesDir = join(import.meta.dirname, "..", "packages");
const dirs = await readdir(packagesDir);
await Promise.all(dirs.map((dir) => syncPackage(join(packagesDir, dir))));
