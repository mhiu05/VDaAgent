Your context is about to be compacted. Everything above this point will be replaced by your summary in a new epoch, and your system prompt will be rendered again from your folder.

Do this now, with your `python` tool, then stop:

1. **Keep what you learned in your folder**, so it comes back in your next system prompt:
   - the user's preferences in `memory/preferences.md`, other notes in `memory/*.md`, and one line per note in `memory/index.md`;
   - durable facts about the user, the business and the data in `prompts/context.md`;
   - procedures you repeat as skills (`skills/<name>/SKILL.md`), reusable code in `helpers/`.
   Keep these files short and current: update, merge and delete, don't just append.
2. **Produce your summary.** If you can use tools, write it with `from contoso import write_summary; write_summary(text)`. Otherwise return the summary as your final plain text; the runtime stores it directly. Include what you need to continue your work:
   - open commitments (what you promised, to whom, by when);
   - recent decisions and their reasons;
   - unresolved questions;
   - the last few exchanges per thread, briefly.
   The summary replaces the previous one, so carry forward anything from it that still matters.
3. **Send no messages.** `send_to_user` and `send_to_agent` don't work during compaction.

When `write_summary` has succeeded, reply with a short plain-text "done" and no tool call. If you returned the summary directly, do not wrap it in commentary.
