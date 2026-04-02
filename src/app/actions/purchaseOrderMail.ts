"use server";

import type { PurchaseOrderMessage } from "@/models/PurchaseOrder";

const UPSTREAM = "https://api.appliedbas.com/v2/mail/po";

export type PurchaseOrderMailResult = {
  ok: boolean;
  status: number;
  body: string;
};

/**
 * Forwards PO mail to the Applied BAS API from the server so the browser never
 * hits cross-origin CORS (which surfaces as TypeError: Failed to fetch even when
 * the upstream request completes). Large payloads use Server Actions body limit
 * in next.config instead of the App Route proxy limit.
 */
export async function submitPurchaseOrderMail(
  message: PurchaseOrderMessage,
  authorization: string
): Promise<PurchaseOrderMailResult> {
  if (!authorization.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      body: JSON.stringify({
        message: "Authorization must start with 'Bearer '",
      }),
    };
  }

  try {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(message),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error("PO mail upstream fetch failed:", err);
    return {
      ok: false,
      status: 502,
      body: JSON.stringify({
        message:
          "Unable to reach the mail service from the server. Check network or API availability.",
      }),
    };
  }
}
