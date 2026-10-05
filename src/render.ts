import { App, Component, MarkdownRenderer, Notice } from "obsidian";

/**
 * Renders a comment body into `el`. With `asMarkdown`, the body is rendered
 * through Obsidian's Markdown pipeline and anchor clicks are wired up; links
 * inside a thread panel sit outside Obsidian's normal link handling (the panel
 * is injected by a post-processor / editor widget), so clicks are intercepted
 * and routed: internal links via `openLinkText`, external links to the system
 * browser. Delegation on `el` covers links added by the async render. Without
 * `asMarkdown`, the body is inserted as plain text.
 */
export function renderCommentBody(
	app: App,
	component: Component,
	el: HTMLElement,
	body: string,
	sourcePath: string,
	asMarkdown: boolean
): void {
	if (!asMarkdown) {
		el.setText(body);
		return;
	}

	void MarkdownRenderer.render(app, body, el, sourcePath, component);

	el.addEventListener("click", (evt) => {
		const anchor = (evt.target as HTMLElement).closest("a");
		if (!anchor) return;

		evt.preventDefault();
		evt.stopPropagation();

		const newLeaf = evt.metaKey || evt.ctrlKey;
		if (anchor.classList.contains("internal-link")) {
			const href = anchor.getAttribute("data-href") ?? anchor.getAttribute("href");
			if (href) void app.workspace.openLinkText(href, sourcePath, newLeaf).catch(() => {
				new Notice("Could not open the linked note.");
			});
		} else {
			const href = anchor.getAttribute("href");
			if (href) window.open(href, "_blank");
		}
	});
}
