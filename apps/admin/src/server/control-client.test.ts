import { describe, expect, it, vi } from "vitest";
import { createLiveControlClient } from "./control-client.js";

describe("live admin control client", () => {
  it("adds machine authentication and server-owned operator headers", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ status: "refused", reason: "Another tournament publication is running" }),
      { status: 409, headers: { "content-type": "application/json", "x-request-id": "request-id" } },
    ));
    const client = createLiveControlClient({
      baseUrl: "http://app:4101",
      machineToken: "machine-token",
      fetch: request,
    });

    const response = await client.mutate(
      { type: "autopilot.set", enabled: false },
      { id: "1234", login: "operator" },
    );

    const [, init] = request.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer machine-token");
    expect(headers.get("x-operator-id")).toBe("1234");
    expect(headers.get("x-operator-login")).toBe("operator");
    expect(headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response).toEqual({
      status: 409,
      body: { status: "refused", reason: "Another tournament publication is running" },
      requestId: "request-id",
    });
  });
});
