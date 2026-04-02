/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("POST /api/mail/pr/test", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 401 when authorization header is missing", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    const request = new NextRequest("http://localhost/api/mail/pr/test", {
      method: "POST",
      body: JSON.stringify({ any: "payload" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toContain("Authorization must start with 'Bearer '");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards request to upstream and mirrors response", async () => {
    const upstreamBody = JSON.stringify({ message: "ok", sent_to: "a@b.com" });
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = new NextRequest("http://localhost/api/mail/pr/test", {
      method: "POST",
      body: JSON.stringify({ project_id: 1 }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });

    const response = await POST(request);
    const raw = await response.text();

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.appliedbas.com/v2/mail/pr/test",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({ project_id: 1 }),
      }
    );
    expect(response.status).toBe(200);
    expect(raw).toBe(upstreamBody);
  });
});
