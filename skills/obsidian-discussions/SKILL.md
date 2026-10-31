---
name: obsidian-discussions
description: Read, write, and reply to Discussions plugin comment blocks in Obsidian Markdown while preserving panel boundaries, reply relationships, and note rendering. Use for Discussions syntax, not percent-delimited Inline Review Comments or Inline Diff proposals.
---

# Discussions syntax

Discussions stores messages as `<comment>` blocks, optionally enclosed in a `<discussion>` panel. Work on the note's raw Markdown using the note access tools available in the current environment. This skill does not require a particular vault, CLI, operating system, or other installed skill.

## Write a message or reply

```markdown
<discussion>
<comment id="1700000000000" author="Reviewer">
Could you explain the recovery steps?
</comment>

<comment id="1700000000001" parent_id="1700000000000" author="Agent">
Added the recovery steps and a verification example.
</comment>
</discussion>
```

The IDs above are examples; generate fresh IDs for real messages.

- Give each message its own complete `<comment>…</comment>` pair. Put the opening tag, body, and closing tag on separate lines.
- Use double-quoted attributes. Supply an `id` and an `author`; use your own author identity for new messages. Simple names without markup or attribute punctuation are safest. Escape `&` as `&amp;` and `"` as `&quot;` in attribute values; do not put a raw `>` in an attribute value.
- An `id` is a Unix timestamp in milliseconds used for identity and chronological sorting. Choose a new numeric value greater than every existing comment ID in the note, for example `max(currentTimeInMilliseconds, largestExistingId + 1)`. Increment it for each additional message in the same edit. Do not renumber existing comments.
- Omit `parent_id` for a new top-level message. For a reply, set it to the ID of the specific message being answered, including when that message is itself a reply.
- The parent must already occur earlier in the same panel. A parent in another panel, a missing parent, or a self-reference will not form the intended reply tree.
- Keep blocks flat in the source. Never physically nest one `<comment>` inside another. The plugin builds nesting from `parent_id` and sorts siblings by numeric ID.

Append a reply **after the last comment in the target panel**, separated by a blank line. In a wrapped panel, insert it **before `</discussion>`**. Do not insert between existing messages or append after the wrapper: that can create a separate panel.

## Preserve panel boundaries

An explicit wrapper contains only complete comments and whitespace:

```markdown
<discussion></discussion>
```

This empty form is valid for templates. For a populated panel, use the multiline layout above. Put a new panel at a block boundary on its own lines, with blank lines around it. Do not place ordinary note prose between its comments, add wrapper attributes, or nest wrappers. Extra prose inside a wrapper prevents it from being recognized as a valid panel.

Existing notes may use the supported unwrapped form:

```markdown
<comment id="1700000000010" author="Reviewer">
Please check this claim.
</comment>

<comment id="1700000000011" parent_id="1700000000010" author="Agent">
Checked and added a source.
</comment>
```

Unwrapped blocks separated **only by whitespace**, including any number of blank lines, share a panel. Intervening prose starts a separate panel. A blank line alone cannot separate two unwrapped panels; use separate wrappers for distinct new panels. Preserve the existing form and location when replying. A panel may appear anywhere in the note body; it need not be at the end of the file.

Keep new panels outside YAML frontmatter, tables, list items, callouts, blockquotes, and other enclosing Markdown structures. Put the panel after the complete structure instead of inserting raw HTML into a table cell or breaking a container's prefixes.

## Format the body without creating tags

Bodies render Markdown when the plugin's Markdown setting is enabled. Use blank lines between paragraphs and before lists:

```markdown
<comment id="1700000000020" author="Agent">
Updated the guide:

- Added an example.
- Explained how to verify the result.

The changes are ready for review.
</comment>
```

Do not blanket-escape the body; that would change Markdown, links, and code. However, literal `<comment>`, `</comment>`, `<discussion>`, or `</discussion>` text in a body must use `&lt;` for its opening angle bracket, for example `&lt;/comment>`. Raw storage tags can truncate or confuse parsing even inside a code example in the body. Actual comment blocks placed inside an external inline-code span or fenced code block are examples, not rendered discussions.

Preserve existing attributes, including integration metadata such as `data-aio-reply`. Do not invent these attributes for ordinary manual replies. A configured `@agent` mention can trigger optional agent execution; use one only when intentionally requesting that agent.

## Edit and verify

1. Read the current note and locate the target panel and message. Preserve existing conversation text; append your response rather than rewriting another author's message. Editing or deleting history requires an explicit request. Deleting a comment in the plugin also deletes its descendants.
2. Recheck the target against the latest content before writing. Use an editor-aware edit for an open unsaved note, or a current-content transform for a file. Avoid whole-note rewrites and global replacements over repeated passages.
3. Preserve unrelated Markdown, frontmatter, block IDs, links, existing proposals, metadata, line endings, and the final-newline state.
4. Reread the saved range. Check balanced, non-nested tags; complete double-quoted attributes; unique numeric IDs; and every new `parent_id` pointing to an earlier message in the same panel. Check that each new message is inside the intended wrapper or unwrapped region and that no surrounding prose was absorbed.
5. When the plugin source is available, use `parseComments`, `parseDiscussionRegions`, and `buildForest` from `src/parser.ts` to confirm message bodies, panel membership, and reply relationships. Parsing alone does not diagnose every malformed tag, so also inspect the raw boundaries.
6. When Obsidian is available, inspect the source and the rendered panel in Live Preview and Reading view. Reading view is read-only for discussion controls. If visual rendering was not checked, report that limit.

Do not mix these tags with `%% … %%` review-comment threading or `{~~old~>new~~}` Inline Diff proposals. Those are separate storage formats; preserve any that already exist in the note.
