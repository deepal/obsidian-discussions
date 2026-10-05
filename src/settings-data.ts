export interface CommentBlockSettings {
	/** Master toggle for rendering threads. When off, raw tags are left as-is. */
	enabled: boolean;
	/** Author name stamped on comments created via the command or Reply button. */
	username: string;
	/** Render comment bodies as Markdown (vs. plain text). */
	renderMarkdown: boolean;
}

export const DEFAULT_SETTINGS: CommentBlockSettings = {
	enabled: true,
	username: "",
	renderMarkdown: true,
};

/** Only recognized, well-typed values may override defaults. */
export function normalizeSettings(raw: unknown): CommentBlockSettings {
	const data = raw !== null && typeof raw === "object" && !Array.isArray(raw)
		? raw as Record<string, unknown> : {};
	return {
		enabled: typeof data.enabled === "boolean" ? data.enabled : DEFAULT_SETTINGS.enabled,
		username: typeof data.username === "string" ? data.username.trim() : DEFAULT_SETTINGS.username,
		renderMarkdown: typeof data.renderMarkdown === "boolean" ? data.renderMarkdown : DEFAULT_SETTINGS.renderMarkdown,
	};
}
