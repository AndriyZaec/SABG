# CS2 arena-open push notifications — production setup

Web Push (the "notify me" toggle on CS2 series screens, `docs/adr/0005-cs2-arena-open-web-push.md`)
needs a VAPID key pair. The backend config is optional (the app won't crash without it — push just
silently no-ops), so this can be done at any point, but the feature is inert in production until
all three steps below are done.

## 1. Generate a VAPID key pair

```
npx web-push generate-vapid-keys
```

Produces a public and a private key. Do this once per environment (devnet/prod) — don't reuse the
dev key pair already in local `.env` files.

## 2. Add the three backend vars to `deploy/app.env` on the server

`deploy/app.env` is not in git (see `deploy/app.env.example` for the template — add these three
lines there too so the template stays complete):

```
VAPID_PUBLIC_KEY=<public key from step 1>
VAPID_PRIVATE_KEY=<private key from step 1>
VAPID_SUBJECT=mailto:<a real contact address>
```

`VAPID_SUBJECT` is a contact the push providers (Chrome/FCM, Mozilla, etc.) can reach if this
server's push traffic ever needs investigating — must be a real `mailto:` or `https://` value, not
a placeholder, in production.

## 3. Pass the public key into the frontend Docker build (the part that's easy to miss)

Vite bakes `import.meta.env.VITE_*` into the static JS bundle **at `docker build` time**, not at
container startup. `deploy/app.env` is only mounted at runtime (`compose.yml`'s `env_file`) — by
then the frontend bundle is already built and immutable, so putting the key there does nothing for
the frontend half.

Also note: `.dockerignore` excludes `.env`, `.env.*`, and `deploy/*.env` from the build context, and
the `Dockerfile` currently accepts no `ARG` for any `VITE_*` variable (only `VCS_REF`). Without the
change below, `VITE_VAPID_PUBLIC_KEY` is simply undefined in the production bundle — the "notify me"
toggle will exist and render, but clicking it always ends in an `error` state (handled gracefully,
no crash, just silently non-functional).

To fix, two changes:

**`Dockerfile`** — add before the `pnpm --filter @arena/web build` step (in the `build` stage):

```dockerfile
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
```

**`.github/workflows/deploy-event.yml`** — in the `publish` job's "Build and push image" step, add
to `build-args:`:

```yaml
build-args: |
  VCS_REF=${{ github.sha }}
  VITE_VAPID_PUBLIC_KEY=${{ vars.VITE_VAPID_PUBLIC_KEY }}
```

`vars.VITE_VAPID_PUBLIC_KEY` should be set as a GitHub Actions repository or environment variable
(Settings → Secrets and variables → Actions → Variables) — it's the *public* key, safe to expose,
so a variable (not a secret) is fine; use the same public key value as `VAPID_PUBLIC_KEY` in
`deploy/app.env` from step 2.

## What already works with no extra steps

- **DB migration** (`apps/api/src/db/migrations/0015_youthful_frightful_four.sql`) — applied
  automatically by the `migrate` service in `compose.yml` on every deploy.
- **`apps/web/public/sw.js`** (the service worker) — Vite copies `public/` into the build output
  same as `manifest.webmanifest` already is; no Caddyfile/compose change needed.
- **The `web-push` npm dependency** — picked up by `pnpm install --frozen-lockfile` in the Docker
  build like any other dependency.
