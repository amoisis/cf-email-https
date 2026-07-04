function authResultPassed(authHeader, method) {
  // Strip RFC 7601 comments so strings inside parentheses cannot spoof results.
  const withoutComments = authHeader.replace(/\([^)]*\)/g, "");
  // Authentication-Results parts are separated by semicolons or whitespace.
  const tokens = withoutComments.split(/[;\s]+/);
  return tokens.some((token) => token === `${method}=pass`);
}

export default {
  async email(message, env, ctx) {
    try {
      // 1. Convert the raw message stream into a string block
      const rawEmailString = await new Response(message.raw).text();
      const sendGridPayload = new FormData();

      // 2. Map standard SendGrid Inbound Parse parameters
      sendGridPayload.append("email", rawEmailString);
      sendGridPayload.append("to", message.headers.get("to") || message.to);
      sendGridPayload.append("from", message.headers.get("from") || message.from);
      sendGridPayload.append("subject", message.headers.get("subject") || "");

      // Replicate SMTP envelope structuring
      const envelopeStructure = {
        from: message.from,
        to: [message.to]
      };
      sendGridPayload.append("envelope", JSON.stringify(envelopeStructure));

      // Replicate static charsets block
      const charsetMap = { to: "UTF-8", subject: "UTF-8", from: "UTF-8" };
      sendGridPayload.append("charsets", JSON.stringify(charsetMap));

      // Extract security checks out of authentication headers
      const authHeader = message.headers.get("Authentication-Results") || message.headers.get("ARC-Authentication-Results") || "";
      sendGridPayload.append("SPF", authResultPassed(authHeader, "spf") ? "pass" : "fail");
      sendGridPayload.append("dkim", authResultPassed(authHeader, "dkim") ? "pass" : "fail");

      // Extract sender routing IP
      const ipMatch = (message.headers.get("received") || "").match(/\[([0-9a-fA-F.:]+)\]/);
      sendGridPayload.append("sender_ip", ipMatch ? ipMatch[1] : "0.0.0.0");

      // Map approximate Cloudflare edge spam scores
      const cloudflareSpamScore = message.headers.get("x-cf-spamh-score") || "0";
      sendGridPayload.append("spam_score", cloudflareSpamScore);
      sendGridPayload.append("spam_report", `Cloudflare Spam Score: ${cloudflareSpamScore}.`);

      // 3. Dispatch payload straight down your cloudflared tunnel path
      const headers = {};
      if (env.CF_CLIENT_ID && env.CF_CLIENT_SECRET) {
        headers["CF-Access-Client-Id"] = env.CF_CLIENT_ID;
        headers["CF-Access-Client-Secret"] = env.CF_CLIENT_SECRET;
      }

      const response = await fetch(env.GATEWAY_URL, {
        method: "POST",
        headers,
        body: sendGridPayload,
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        message.setReject(`Home target returned bad status: ${response.status}`);
      }
    } catch (err) {
      // Log the full error server-side; never echo it to the untrusted sender.
      console.error("Email gateway delivery failed:", err);

      if (err.name === "AbortError") {
        message.setReject("Gateway request timed out");
      } else {
        message.setReject("Unable to deliver message to gateway");
      }
    }
  }
};