import { createAdminApp } from "./app.js";
import { readAdminConfig } from "./config.js";
import { createLiveControlClient } from "./control-client.js";
import { attachAdminFrontend } from "./frontend.js";
import { createGitHubOAuthClient } from "./github.js";

const config = readAdminConfig(process.env);
const github = createGitHubOAuthClient({
  clientId: config.githubClientId,
  clientSecret: config.githubClientSecret,
  callbackUrl: `${config.publicOrigin}/auth/github/callback`,
});
const control = createLiveControlClient(config.control);
const app = createAdminApp({ config, github, control });
await attachAdminFrontend(app, process.env["NODE_ENV"]);

app.listen(config.port, "0.0.0.0", () => {
  console.info(`SABG admin listening on port ${config.port}`);
});
