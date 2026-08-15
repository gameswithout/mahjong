# Localization workflow

The source of truth is `client/i18n/catalog.json`. Every row has a stable semantic key, usage context, English source, Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-TW`), and review status.

All Chinese entries currently carry `ai_draft`. They are usable development translations, not professional, rules, legal, safety, or cultural approval. Taiwanese Mahjong terms follow the product specification: Tai = 台, Ting = 聽牌, Chow = 吃, Pong = 碰, Kong = 槓, and Jade = 玉.

Run `npm run i18n:export` after editing the catalog. Send `docs/localization/translations.csv` to translators, have them preserve the `key` and all `{placeholders}`, then copy approved wording back into the catalog and change `status` to `professional_reviewed`. Review Simplified and Traditional Chinese independently, and keep a row at `ai_draft` until both locale values are approved.

The runtime accepts `en`, `zh-CN`, and `zh-TW`. Browser tags using `zh-Hans` resolve to `zh-CN`; `zh-Hant`, `zh-HK`, and `zh-MO` resolve to `zh-TW`. The chosen locale is stored locally, is sent as the AGS IAM `languageTag` for registration and guest-upgrade verification emails, and is exposed through `getAgsLanguageTag()` for future localized Store or Achievement content calls.
