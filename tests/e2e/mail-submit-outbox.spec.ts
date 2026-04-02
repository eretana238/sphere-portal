import { test, expect } from "@playwright/test";

const frontendBase = process.env.E2E_FRONTEND_BASE_URL;
const backendBase = process.env.E2E_BACKEND_BASE_URL;
const token = process.env.E2E_BEARER_TOKEN ?? "test-token";

test("frontend submit reaches backend test outbox", async ({ request }) => {
  test.skip(!frontendBase || !backendBase, "Set E2E_FRONTEND_BASE_URL and E2E_BACKEND_BASE_URL.");

  const clear = await request.delete(`${backendBase}/v1/test/outbox`);
  expect(clear.ok()).toBeTruthy();

  const payload = {
    report_no: 501,
    date: "2026-04-01",
    client_name: "QA Client",
    service_address: "123 Main St",
    city_state_zip: "Denver, CO 80014",
    contact_name: "QA Contact",
    contact_phone: "123-456-7890",
    contact_email: "qa@example.com",
    signature: null,
    t_time: 1,
    t_ot: 0,
    h_time: 0,
    h_ot: 0,
    materials: "n/a",
    notes: [],
    technician_name: "Tech",
    technician_phone: "123-456-7890",
    technician_email: "tech@example.com",
    print_name: null,
    sign_date: null,
    to_emails: ["qa@example.com"],
    start_date: "2026-04-01",
    end_date: "2026-04-01",
  };

  const submit = await request.post(`${frontendBase}/api/mail/sr`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: payload,
  });
  expect([200, 202]).toContain(submit.status());

  const outbox = await request.get(`${backendBase}/v1/test/outbox`);
  expect(outbox.ok()).toBeTruthy();
  const body = await outbox.json();
  expect(body.count).toBeGreaterThanOrEqual(1);
});
