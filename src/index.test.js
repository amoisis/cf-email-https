import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index.js";

describe("Email Worker Gateway Suite", () => {
  let mockMessage;
  let mockEnv;
  let mockCtx;

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock global network fetch utilities
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    // Replicate a pristine incoming email data stream block
    const rawEmailText = "Subject: Hello World\n\nThis is a pristine email body.";
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(rawEmailText));
        controller.close();
      },
    });

    // Populate fake inbound delivery metadata tracking headers
    const headers = new Headers();
    headers.set("to", "receiver@example.com");
    headers.set("from", "sender@example.com");
    headers.set("subject", "Hello World");
    headers.set("Authentication-Results", "spf=pass dkim=pass");
    headers.set("received", "from mail.example.com ([192.168.1.100])");
    headers.set("x-cf-spamh-score", "2");

    // Mimic the native properties of Cloudflare's internal email runtime object
    mockMessage = {
      from: "sender@example.com",
      to: "receiver@example.com",
      headers: headers,
      raw: stream,
      rawSize: rawEmailText.length,
      setReject: vi.fn(),
    };

    mockEnv = {
      GATEWAY_URL: "https://mock-gateway.local/api/inbound",
      CF_CLIENT_ID: "mock-client-id",
      CF_CLIENT_SECRET: "mock-client-secret",
    };

    mockCtx = {
      waitUntil: vi.fn(),
    };
  });

  it("should successfully process and forward structured multipart emails", async () => {
    await worker.email(mockMessage, mockEnv, mockCtx);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    
    // Inspect outbound network parameters
    const [calledUrl, calledOptions] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(calledUrl).toBe(mockEnv.GATEWAY_URL);
    expect(calledOptions.method).toBe("POST");
    expect(calledOptions.headers["CF-Access-Client-Id"]).toBe("mock-client-id");
    expect(calledOptions.headers["CF-Access-Client-Secret"]).toBe("mock-client-secret");
    
    // Confirm body translates safely using standard FormData boundaries
    expect(calledOptions.body).toBeInstanceOf(FormData);
    expect(mockMessage.setReject).not.toHaveBeenCalled();
  });

  it("should gracefully reject the inbound mail if the webhook gateway fails", async () => {
    // Force a 500 Internal Server error response mock setup
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await worker.email(mockMessage, mockEnv, mockCtx);

    // Verify code commands Cloudflare's SMTP servers to safely bounce/retry the mail
    expect(mockMessage.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Home target returned bad status: 500")
    );
  });

  it("should omit Cloudflare Access headers when credentials are not configured", async () => {
    const envWithoutAccess = { ...mockEnv, CF_CLIENT_ID: undefined, CF_CLIENT_SECRET: undefined };

    await worker.email(mockMessage, envWithoutAccess, mockCtx);

    const [, calledOptions] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(calledOptions.headers).not.toHaveProperty("CF-Access-Client-Id");
    expect(calledOptions.headers).not.toHaveProperty("CF-Access-Client-Secret");
    expect(mockMessage.setReject).not.toHaveBeenCalled();
  });

  it("should not treat authentication results inside comments as passes", async () => {
    mockMessage.headers.set(
      "Authentication-Results",
      "example.com; dkim=pass (spf=pass comment) spf=fail"
    );

    await worker.email(mockMessage, mockEnv, mockCtx);

    const [, calledOptions] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = calledOptions.body;
    expect(body.get("SPF")).toBe("fail");
    expect(body.get("dkim")).toBe("pass");
  });

  it("should reject the message when the gateway request times out", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "AbortError"));

    await worker.email(mockMessage, mockEnv, mockCtx);

    expect(mockMessage.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Gateway request timed out")
    );
  });

  it("should reject the message when payload construction throws", async () => {
    mockMessage.raw = new ReadableStream({
      start(controller) {
        controller.error(new Error("stream broken"));
      },
    });

    await worker.email(mockMessage, mockEnv, mockCtx);

    expect(mockMessage.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Unable to deliver message to gateway")
    );
  });
});