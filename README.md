# Vic's AI

Create studio-quality music with AI. Describe a mood, a genre or paste your own
lyrics — Vic's AI writes, performs and produces a finished track in minutes, in
any style, in any language.

A marketing site and the full application ship from a single Node service, with
generation running on a remote GPU and all data in hosted Postgres and object
storage. Nothing depends on the machine you develop on.

---

## What's here

| Path | |
|---|---|
| `landing/` | Marketing site served at `/` |
| `App.tsx`, `components/` | React application served at `/app` |
| `server/` | Express API, database and storage layers |
| `deploy/modal_app.py` | GPU inference service |

## Architecture

```
Browser ──► Node service ──┬──► Postgres        (accounts, libraries)
            /  /app  /api  ├──► Object storage  (audio)
                           └──► GPU service     (generation)
```

One deployable process. No GPU, disk or volume required on the web host.

## Running locally

```bash
npm install && (cd server && npm install)
cp server/.env.example server/.env     # then fill in the values below
npm run build                          # builds the app into dist/
cd server && npm run dev               # serves everything on PORT
```

Open the port you configured — marketing site at `/`, application at `/app`.

During UI development you can run `npm run dev` from the root for hot reload;
the API is proxied to the backend port.

## Configuration

Set these in `server/.env`:

| Variable | Purpose |
|---|---|
| `PORT` | Port for the combined site + app + API |
| `DATABASE_URL` | Postgres connection string. Omit to use local SQLite |
| `S3_ENDPOINT` / `S3_BUCKET` | S3-compatible storage. Omit to use local disk |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Storage credentials |
| `S3_PUBLIC_BASE_URL` | Public origin for permanent audio URLs |
| `ACESTEP_API_URL` | Generation service endpoint |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Continue with Google" |
| `DISABLE_AUTO_LOGIN` | Set `true` in production to require real accounts |
| `JWT_SECRET` | Signing secret for session tokens |

## Checking a deployment

```bash
cd server && npm run check:deploy
```

Verifies the database, object storage and generation service independently and
reports exactly what is misconfigured.

## Accounts

Sign in with email and password or with Google. Each account gets its own
library; tracks are never shared between users. Set `DISABLE_AUTO_LOGIN=true`
in production so the single-user development shortcut is unavailable.

## GPU

Generation runs on CPU by default, which works but is slow. Point
`MODAL_GPU` at a GPU type and redeploy the inference service to cut
generation from minutes to seconds:

```bash
MODAL_GPU=T4 modal deploy deploy/modal_app.py
```
