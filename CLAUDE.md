# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — starts the server via `nodemon index.js`. There is no `start`, `build`, `lint`, or `test` script; the same command is used in production (see `Dockerfile`).
- `docker compose -f docker-compose-prod.yml up -d --build` — production container build. The compose file is gitignored locally and lives on the deploy server.

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

**Bot module** ([src/bot/](src/bot/)):
- [bot.js](src/bot/bot.js) creates the `TelegramBot` instance and sets the chat menu button to the Mini App. It re-exports `bot` and then `require`s `./message` and `./query` so their handlers attach on first import. Anything that needs to register Telegram event handlers must be loaded here, not elsewhere, or it will silently not fire.
- [helper/start.js](src/bot/helper/start.js) handles `/start`: upserts a `Users` document keyed by `chat_id` and sends a single inline button that opens `MINI_APP_URL` as a Telegram `web_app`.
- [menu/keyboard.js](src/bot/menu/keyboard.js) defines reply keyboards (UZ/RU) but most are not currently wired into the message flow.

**HTTP module** ([src/modules/](src/modules/)):
- `routes.js` → mounts `auth/routes.js` at `/v1`. The auth routes (`GET /admin`, `GET /me`, `POST /login`, `POST /register`) are scaffolded; all handlers in [auth/auth.js](src/modules/auth/auth.js) except `GET` are empty `try/catch` stubs. When implementing endpoints, follow the pattern: handler exports object → router wires verbs → use `next(err)` so [middleware/errorHandler.js](src/middleware/errorHandler.js) and the custom `Errorhandler` class in [exseptions/ErrorHandler.js](src/exseptions/ErrorHandler.js) (note the spelling) format the response.
- [middleware/verify.js](src/middleware/verify.js) reads `Authorization: Bearer <token>`, verifies with `SECRET_KEY`, and puts the decoded `id` on `req.id`. JWTs are signed by [utils/jwt.js](src/utils/jwt.js) with no expiry.

**Module system caveat:** the project is CommonJS (`require` / `module.exports`). Two files use ES `import` syntax and would crash if loaded:
- [src/validation/validation.js](src/validation/validation.js) — all schemas are commented out; the lone `import` line is dead.
- [src/middleware/verifyLogout.js](src/middleware/verifyLogout.js) — also references a missing `src/utils/postgres.js`. Not imported anywhere.

If you need either, rewrite in CommonJS before requiring.

**Data model** ([src/model/users.js](src/model/users.js)): single `Users` schema with `chat_id`, `full_name`, `admin`. Several handlers (`start.js`, the commented cron jobs) read fields like `access`, `join`, `language`, `subscriptionEnd` that the current schema doesn't declare — they exist only in dead code from a prior subscription-bot iteration. Don't model new code after those fields unless you also add them to the schema.

**Bot UI language:** user-facing strings are Uzbek (mixed Cyrillic for the active Mini-App start flow, Latin in legacy code). Keep new bot copy in Uzbek Cyrillic to match [helper/start.js](src/bot/helper/start.js) unless told otherwise.
