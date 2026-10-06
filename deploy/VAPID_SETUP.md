# CS2 arena-open push notifications - production setup

Web Push (the "notify me" toggle on CS2 series screens)
needs a VAPID key pair. The backend config is optional (the app won't crash without it - push just
silently no-ops), so this can be done at any point, but the feature is inert in production until
all setup steps below are done.

## 1. Generate a VAPID key pair

```bash
pnpm dlx web-push@3.6.7 generate-vapid-keys
```

Generate the pair once per environment. Store the private key in the team's secret manager; never
commit it or send it through chat. The public key is safe to share.

## 2. Configure the frontend build

Create the repository-level GitHub Actions variable below under **Settings -> Secrets and variables
-> Actions -> Variables**:

```text
VITE_VAPID_PUBLIC_KEY=<public key from step 1>
```

The release workflow passes this variable into the Docker build. Vite embeds it in the immutable
frontend bundle, so changing it requires building and deploying a new image.

## 3. Configure the backend runtime

Add all three values to the server's gitignored `deploy/app.env`:

```dotenv
VAPID_PUBLIC_KEY=<public key from step 1>
VAPID_PRIVATE_KEY=<private key from step 1>
VAPID_SUBJECT=mailto:<real contact address>
```

`VITE_VAPID_PUBLIC_KEY` and `VAPID_PUBLIC_KEY` must match. `VAPID_SUBJECT` must be a real `mailto:`
or `https://` contact. Restarting the backend is sufficient for runtime-only changes, but a public
key change also requires a new frontend image.

## 4. Deploy and verify

1. Push a release branch so `.github/workflows/deploy-event.yml` builds with the repository variable.
2. Confirm the VPS has all three backend values before the new container starts.
3. On `app.sabg.fun`, enable notifications on a CS2 series and confirm the browser grants permission
   without the UI entering the `error` state.

## Team ownership

- Repo admin: set `VITE_VAPID_PUBLIC_KEY` as a GitHub Actions repository variable.
- VPS operator: store the three backend values in `deploy/app.env`.
- Secret owner: retain the private key in the team secret manager and rotate the full pair together.

## What already works with no extra steps

- **DB migration** (`apps/api/src/db/migrations/0015_youthful_frightful_four.sql`) — applied
  automatically by the `migrate` service in `compose.yml` on every deploy.
- **`apps/web/public/sw.js`** (the service worker) — Vite copies `public/` into the build output
  same as `manifest.webmanifest` already is; no Caddyfile/compose change needed.
- **The `web-push` npm dependency** — picked up by `pnpm install --frozen-lockfile` in the Docker
  build like any other dependency.
