import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Run before the release commit and tag so the default branch and release
// attachment both contain the version Obsidian will use to find the release.
export function prepare(_pluginConfig, { cwd, env, nextRelease, logger }) {
	const { version } = nextRelease;
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
		throw new Error(`Obsidian requires an x.y.z release version; received ${version}`);
	}

	const files = ["package.json", "package-lock.json", "manifest.json", "versions.json"];
	const [pkg, lock, manifest, versions] = files.map((file) =>
		JSON.parse(readFileSync(join(cwd, file), "utf8"))
	);
	pkg.version = version;
	lock.version = version;
	lock.packages[""].version = version;
	manifest.version = version;
	versions[version] = manifest.minAppVersion;

	for (const [index, value] of [pkg, lock, manifest, versions].entries()) {
		writeFileSync(join(cwd, files[index]), JSON.stringify(value, null, "\t") + "\n");
	}
	logger.log("Updated plugin and package versions to %s", version);

	// Build after the version update, and fail before tagging if the build or
	// any required release attachment is missing or empty.
	execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
		cwd,
		stdio: "inherit",
		env: { ...env, OBSIDIAN_VAULT_DIR: "", OBSIDIAN_PLUGIN_DIR: "" },
	});
	for (const file of ["main.js", "manifest.json", "styles.css"]) {
		const stat = statSync(join(cwd, file));
		if (!stat.isFile() || stat.size === 0) {
			throw new Error(`Required release asset is missing or empty: ${file}`);
		}
	}
}
