import { test, expect } from "@playwright/test";

const frontendBase = process.env.E2E_FRONTEND_BASE_URL;
const backendBase = process.env.E2E_BACKEND_BASE_URL;
const token = process.env.E2E_BEARER_TOKEN ?? "test-token";

test("frontend project-report submit reaches backend test outbox", async ({ request }) => {
  test.skip(!frontendBase || !backendBase, "Set E2E_FRONTEND_BASE_URL and E2E_BACKEND_BASE_URL.");

  const clear = await request.delete(`${backendBase}/v1/test/outbox`);
  expect(clear.ok()).toBeTruthy();

  const payload = {
    technician_name: "Tech",
    technician_phone: "123-456-7890",
    technician_email: "tech@example.com",
    location: "Building A",
    description: "Routine project report",
    project_id: 701,
    doc_id: 1,
    project_subtitle: "Electrical",
    date: "2026-04-01",
    client_name: "QA Client",
    materials: "n/a",
    notes: "no issues",
  };

  const submit = await request.post(`${frontendBase}/api/mail/pr`, {
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
