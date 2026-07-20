# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — starts the server via `nodemon index.js`. There is no `start`, `build`, `lint`, or `test` script; the same command is used in production (`CMD ["npm", "run", "dev"]` in the local Dockerfile).
- `docker compose -f docker-compose-prod.yml up -d --build` — production container build. `Dockerfile`, `docker-compose-prod.yml`, and `docker-compose-dev.yml` are all `.gitignore`d — the copies that actually run are maintained on the deploy server. Local copies here may drift from what production uses.

Deployment is automated by [.github/workflows/deploy.yml](.github/workflows/deploy.yml): pushes to `main` SSH into the prod host and rebuild the prod compose stack; pushes to `dev` do the same for the dev stack. There is no staging step — merging to `main` deploys.

## Required environment

Copy `.env.example` → `.env`. The process will throw on startup if `TOKEN` (or `BOT_TOKEN`) or `MINI_APP_URL` is missing. `MONGO_URL`, `PORT`, `SECRET_KEY`, and `GROUP_ID` are also expected.

## Architecture

This is a Telegram bot + Express REST API in a single Node.js process. The bot is a thin shell whose primary job is to launch a Telegram Mini App (the URL in `MINI_APP_URL`); the REST API under `/v1/*` is the backend the Mini App talks to.

**Entry flow** ([index.js](index.js)):
1. Connects to Mongo via Mongoose.
2. Mounts Express routes under `/v1` (see [src/modules/routes.js](src/modules/routes.js)).
3. `require("./src/bot/bot")` — bot starts in **polling mode** as a side effect of import. Only one process per bot token can run at a time, or Telegram will reject updates.
4. `require("./src/utils/cron")` — cron module is currently entirely commented out but the require stays so jobs can be re-enabled without touching `index.js`.

`index.js` also declares two ad-hoc handlers **outside** the `/v1` router: `GET /getAllUsers` dumps every `Users` doc, and `GET /updateOperators` calls `updateAllOperatorsData()` which is not defined or imported anywhere — hitting that route throws a `ReferenceError`. Treat these as leftover scaffolding; move real work into a proper `src/modules/*` module rather than adding more of them.

**Bot module** ([src/bot/](src/bot/)):
- [bot.js](src/bot/bot.js) creates the `TelegramBot` instance in polling mode, then re-exports `bot` and `require`s `./message` and `./query` so their handlers attach on first import. Anything that needs to register Telegram event handlers must be loaded here, not elsewhere, or it will silently not fire. **Both the bot command list (`/` autocomplete) and the chat menu button (bottom-left in-chat launcher) are intentionally NOT set from code — they are managed manually via BotFather.** The old `bot.setMyCommands(...)` call is removed and `bot.setChatMenuButton(...)` is commented out at the bottom of `bot.js`; do not re-enable either without a reason. `MINI_APP_URL` and `TOKEN`/`BOT_TOKEN` are still validated on startup (throw if missing) because they're consumed by `start.js` / `broadcast.js` regardless.
- [message.js](src/bot/message.js) intercepts the hidden admin commands `/statshour` and `/broadcast` first (see below); everything else — including those commands typed by non-authorised users — falls through to `start(msg)`. The `if (text == "/start" || text == "🔙 Menu")` guard is commented out, so any other text re-opens the Mini App greeting. Restore or replace that guard before adding new text-based flows.
- [helper/admins.js](src/bot/helper/admins.js) is the single source of truth for the admin-command allow-list (`umirzakov_mu`, `mirxonjon`, lowercase, matched case-insensitively). Both admin commands import from here; add usernames here rather than duplicating the set.
- [helper/statistika.js](src/bot/helper/statistika.js) — hidden `/statshour` command. Not registered in `bot.setMyCommands`, so it does not appear in Telegram's command-menu autocomplete. Non-authorised users fall through to `start()`, so the command's existence is not observable from the outside. Output is today's full day (Asia/Tashkent, UTC+5), 24 hourly buckets `00-01` … `23-00`, formatted as a single 4-column monospace table sent inside `<pre>` (HTML parse_mode) so Telegram renders a "copy" chip. Columns: `F` = bot signups (`Users.createdAt`), `K` = post views (`STATS_API_URL` timeseries, default `https://api.logistic-dev.coachingzona.uz/v1/stats/timeseries`, path `STATS_API_PATH` default `/v1/post/all`), `T` = telegram-button clicks and `C` = call-button clicks (both from `STATS_BUTTON_API_URL`, default `https://api.logistic-dev.coachingzona.uz/v1/stats/button-clicks`, fields `tg` / `call` per point). DB query and both HTTP calls run in `Promise.all`. Timezone shift is applied at query time only — `createdAt` is stored as UTC and not rewritten. If either API errors, `(API xatosi)` is appended to the `Umumiy` line rather than aborting the response.
- [helper/broadcast.js](src/bot/helper/broadcast.js) — hidden `/broadcast` command. **Interactive two-step flow**: admin types `/broadcast` → bot asks for content → admin sends any message (text, photo, video, document — any format) → bot copies it back as preview with the "🚚 Юкларни кўриш" Mini App button attached and asks "Xabarni tasdiqlaysizmi?" with `✅ Ha` / `❌ Yo'q` inline buttons → on confirm, `bot.copyMessage` fans the draft out to every user in `Users` with the same button, throttled at ~20 msg/sec, with Telegram `429` retry and per-user error logging, ending in a `Yuborildi / Xatolik / Jami` summary to the admin. State (`awaitingMessage` Set + `pendingDrafts` Map) is **in-memory**; process restarts drop pending drafts, and a 10-minute TTL clears abandoned ones. Confirmation callbacks are routed via [query.js](src/bot/query.js) using `callback_data` values `broadcast_confirm` / `broadcast_cancel`. `copyMessage` was chosen over `sendMessage`+entities so any message type works transparently, formatting preserved, no "Forwarded from" tag.
- [helper/start.js](src/bot/helper/start.js) handles the `/start` flow: upserts a `Users` document keyed by `chat_id` and replies with **two** inline `web_app` buttons — the Mini App (`MINI_APP_URL` from env) and a **hardcoded** "🧭 Диспетчер платформаси" URL (`DISPATCHER_URL` constant, `https://yukchi-dispetcher.coachingzona.uz/auth`). If the dispatcher host ever changes, this is the only place to update it — it is not read from env. Both buttons use `web_app` so they open inside Telegram as Mini Apps rather than in an external browser.
- [query.js](src/bot/query.js) handles inline-button `callback_query` events. Currently wired to broadcast confirmation callbacks (`broadcast_confirm`, `broadcast_cancel`) — both are admin-gated via [helper/admins.js](src/bot/helper/admins.js). New callback_data values must be routed here.
- [menu/keyboard.js](src/bot/menu/keyboard.js) defines reply keyboards (UZ/RU) but most are not currently wired into the message flow.

**HTTP module** ([src/modules/](src/modules/)):
- `routes.js` → mounts `auth/routes.js` at `/v1`. The auth routes (`GET /admin`, `GET /me`, `POST /login`, `POST /register`) are scaffolded; all handlers in [auth/auth.js](src/modules/auth/auth.js) except `GET` are empty `try/catch` stubs. When implementing endpoints, follow the pattern: handler exports object → router wires verbs → use `next(err)` so [middleware/errorHandler.js](src/middleware/errorHandler.js) and the custom `Errorhandler` class in [exseptions/ErrorHandler.js](src/exseptions/ErrorHandler.js) (note the spelling) format the response. `errorHandler.js` branches on `NODE_ENV`: `development` returns the raw error message, `production` returns only the generic `http.STATUS_CODES[status]` — so custom messages will be swallowed in prod unless you also serialize them into the payload.
- [middleware/verify.js](src/middleware/verify.js) reads `Authorization: Bearer <token>`, verifies with `SECRET_KEY`, and puts the decoded `id` on `req.id`. JWTs are signed by [utils/jwt.js](src/utils/jwt.js) with no expiry. Convention: routes that need the caller identity go through `verify` (see `/v1/me`); `/v1/admin` is currently public despite the name.
- [middleware/validation.js](src/middleware/validation.js) is a Joi-schema wrapper — call it as `validation(schema)` in a route, and validated input lands on `req.filtered` (not `req.body`). Read from `req.filtered` in handlers that use it. Note this is unrelated to [src/validation/validation.js](src/validation/validation.js), which is dead ESM code (see below).

**Module system caveat:** the project is CommonJS (`require` / `module.exports`). Two files use ES `import` syntax and would crash if loaded:
- [src/validation/validation.js](src/validation/validation.js) — all schemas are commented out; the lone `import` line is dead.
- [src/middleware/verifyLogout.js](src/middleware/verifyLogout.js) — also references a missing `src/utils/postgres.js`. Not imported anywhere.

If you need either, rewrite in CommonJS before requiring.

**Data model** ([src/model/users.js](src/model/users.js)): single `Users` schema with `chat_id`, `full_name`, `admin`. Several handlers (`start.js`, the commented cron jobs) read fields like `access`, `join`, `language`, `subscriptionEnd` that the current schema doesn't declare — they exist only in dead code from a prior subscription-bot iteration. Don't model new code after those fields unless you also add them to the schema.

**Bot UI language:** user-facing strings are Uzbek (mixed Cyrillic for the active Mini-App start flow, Latin in legacy code). Keep new bot copy in Uzbek Cyrillic to match [helper/start.js](src/bot/helper/start.js) unless told otherwise.
