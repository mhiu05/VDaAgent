# 0021 · A Vietnamese and English UI

- **Context.** The PoC spec planned a Vietnamese-only UI, with one dictionary and no i18n framework. The frontend that was actually built uses i18next with Vietnamese and English, together with locale-aware number and date formats.
- **Decision.** Keep both languages; Vietnamese is the default. The locale is a user preference ([19](../19-reports-dashboard-notifications.md#preferences)). It changes control labels and formats only. Agent messages, saved reports and fixed demo content keep the language they were written in. User notification templates exist in both languages. API error `message` stays Vietnamese, but the UI shows its own text for each error code.
- **Rejected.** Removing English to match the spec: it throws away working code and tests and gains nothing.
- **Consequences.** Every new UI string needs both translations. Agents still answer in Vietnamese unless the user asks otherwise. See [14](../14-frontend.md#language).
