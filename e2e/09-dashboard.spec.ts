import { expect, test } from "@playwright/test"

test.describe("Dashboard", () => {
  test("/ loads with landing hero and status cards", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page.getByRole("heading", { name: "YG-1 Recommendation Hub" })).toBeVisible()
    await expect(page.getByText("AI Recommendation Readiness")).toBeVisible()

    for (const label of ["New", "In Review", "Need Info", "Quote Drafted", "Sent", "Escalated"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test("/ shows metrics and trends", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("Request Trends")).toBeVisible()
    await expect(page.getByText("Top Requested Products")).toBeVisible()
    await expect(page.getByText("Top Missing Fields")).toBeVisible()
    await expect(page.getByText("Performance Snapshot")).toBeVisible()
    await expect(page.getByText("Average Time to Quote")).toBeVisible()
  })

  test("/ shows quick launch cards", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page.locator('a[href="/products"]').filter({ hasText: "Smart Tool Recommendation" }).last()).toBeVisible()
    await expect(page.locator('a[href="/inbox"]').filter({ hasText: "Inquiry Inbox" }).last()).toBeVisible()
    await expect(page.locator('a[href="/quotes"]').filter({ hasText: "Quote Workspace" }).last()).toBeVisible()
    await expect(page.locator('a[href="/knowledge"]').filter({ hasText: "Knowledge Base" }).last()).toBeVisible()
  })
})
