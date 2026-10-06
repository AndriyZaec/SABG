import { createAdminApp } from "./app.js";
import { readAdminConfig } from "./config.js";
import { createFixtureControlClient, createLiveControlClient } from "./control-client.js";
import { attachAdminFrontend } from "./frontend.js";
import { createGitHubOAuthClient } from "./github.js";

const config = readAdminConfig(process.env);
const github = createGitHubOAuthClient({
  clientId: config.githubClientId,
  clientSecret: config.githubClientSecret,
  callbackUrl: `${config.publicOrigin}/auth/github/callback`,
});
const control = config.control.mode === "fixture"
  ? createFixtureControlClient()
  : createLiveControlClient(config.control);
const app = createAdminApp({ config, github, control });
await attachAdminFrontend(app, process.env["NODE_ENV"]);

const listenHost = config.control.mode === "fixture" || config.authMode === "fixture" ? "127.0.0.1" : "0.0.0.0";
app.listen(config.port, listenHost, () => {
  console.info(`SABG admin listening on port ${config.port}`);
});
