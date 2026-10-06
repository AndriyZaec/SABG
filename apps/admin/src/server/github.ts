import { z } from "zod";

const TokenResponseSchema = z.object({ access_token: z.string().min(1) });
const UserResponseSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1).max(100) });

export interface GitHubUser {
  id: string;
  login: string;
}

export interface GitHubOAuthClient {
  authorizationUrl(state: string): string;
  complete(code: string): Promise<GitHubUser>;
}

export function createGitHubOAuthClient(options: {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  fetch?: typeof globalThis.fetch;
}): GitHubOAuthClient {
  const request = options.fetch ?? globalThis.fetch;
  return {
    authorizationUrl(state) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", options.callbackUrl);
      url.searchParams.set("scope", "read:user");
      url.searchParams.set("state", state);
      return url.toString();
    },
    async complete(code) {
      const tokenResponse = await request("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          redirect_uri: options.callbackUrl,
        }),
      });
      if (!tokenResponse.ok) throw new Error("GitHub OAuth token exchange failed");
      const { access_token: accessToken } = TokenResponseSchema.parse(await tokenResponse.json());

      const userResponse = await request("https://api.github.com/user", {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${accessToken}`,
          "user-agent": "sabg-admin",
          "x-github-api-version": "2022-11-28",
        },
      });
      if (!userResponse.ok) throw new Error("GitHub user lookup failed");
      const user = UserResponseSchema.parse(await userResponse.json());
      return { id: String(user.id), login: user.login };
    },
  };
}
