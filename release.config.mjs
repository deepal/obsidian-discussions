export default {
	branches: ["main"],
	// Obsidian looks up releases by the exact manifest version, without a v prefix.
	tagFormat: "${version}",
	plugins: [
		["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
		["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
		["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
		"./scripts/semantic-release.mjs",
		["@semantic-release/git", {
			assets: ["CHANGELOG.md", "package.json", "package-lock.json", "manifest.json", "versions.json"],
			message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
		}],
		["@semantic-release/github", {
			assets: ["main.js", "manifest.json", "styles.css"],
			// Release publishing only; do not post comments on issues or pull requests.
			successCommentCondition: false,
			failCommentCondition: false,
			labels: false,
			addReleases: false,
		}],
	],
};
