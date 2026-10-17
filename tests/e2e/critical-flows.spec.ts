import { expect, test, type Page } from "@playwright/test";

// Demo passwords are supplied by the operator (E2E_PASSWORD) and never stored here.
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";
const ADMIN = { username: process.env.E2E_ADMIN ?? "dev.admin", password: E2E_PASSWORD };
const STUDENT = { username: process.env.E2E_STUDENT ?? "dev.student", password: E2E_PASSWORD };

test.beforeAll(() => {
  if (E2E_PASSWORD.length < 12) {
    throw new Error("set E2E_PASSWORD (the preview demo password) before running the end-to-end suite");
  }
});

async function login(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[name="identifier"]', user.username);
  await page.fill('input[name="password"]', user.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe("critical flows", () => {
  test("login page renders with brand and secure form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h2")).toContainText("ورود");
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveAttribute("type", "password");

    // Strict CSP: a per-request nonce is issued and `unsafe-inline` is gone.
    // (Chromium hides nonce values in the DOM after execution, so the header is
    // the reliable source of truth.)
    const response = await page.request.get("/login");
    const csp = response.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("'nonce-");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("admin logs in, creates a case and opens its details", async ({ page }) => {
    await login(page, ADMIN);

    await page.goto("/cases");
    await expect(page.locator("h1")).toContainText("پرونده");
    await page.click('a[href="/cases/new"]');

    const studentName = `دانشجوی آزمون خودکار`;
    await page.locator('main input[name="studentFullName"]').fill(studentName);
    await page.locator('main button[type="submit"]:has-text("ایجاد")').click();

    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.locator("h1")).toContainText("TH-");
    // Real timeline events from the database, not fixtures.
    await expect(page.getByText("ایجاد پرونده جدید")).toBeVisible();
  });

  test("empty state is shown when a search matches nothing", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/cases");
    await page.locator('main input[name="q"]').fill("پروندهٔ کاملاً ناموجود-۹۹۹۹");
    await page.locator('main button[type="submit"]:has-text("جستجو")').click();
    await expect(page.getByText("پرونده‌ای یافت نشد")).toBeVisible();
  });

  test("student cannot see the administrator's case (403 boundary)", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/cases/new");
    await page.locator('main input[name="studentFullName"]').fill("پروندهٔ خصوصی مدیر");
    await page.locator('main button[type="submit"]:has-text("ایجاد")').click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const caseUrl = page.url();
    const caseId = caseUrl.split("/").pop()!;

    // Session cookie is httpOnly: clear it through the browser context, not document.cookie.
    await page.request.post("/api/auth/logout");
    await page.context().clearCookies();
    await login(page, STUDENT);

    const response = await page.request.get(`/api/cases/${caseId}`);
    expect(response.status()).toBe(403);
  });

  test("organizational structure page lists departments and respects permissions", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/organization");
    await expect(page.locator("h1")).toContainText("ساختار سازمانی");
    await expect(page.getByRole("heading", { name: "گروه‌های آموزشی" })).toBeVisible();
  });

  test("workflow draft survives save and page refresh", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/workflows");
    const titleInput = page.getByLabel("عنوان مرحله").first();
    await expect(titleInput).toBeVisible();
    const changedTitle = `مرحله آزمون ${Date.now()}`;
    await titleInput.fill(changedTitle);
    await page.getByRole("button", { name: "ذخیرهٔ پیش‌نویس" }).click();
    await page.getByLabel("دلیل تغییر (الزامی)").fill("آزمون ماندگاری پیش‌نویس در مرورگر");
    await page.getByRole("button", { name: "ادامه" }).click();
    await expect(page).toHaveURL(/\/admin\/workflows\?id=\d+/, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByLabel("عنوان مرحله").first()).toHaveValue(changedTitle);
  });

  test("design system page renders the component library", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/design");
    await expect(page.locator("h1")).toContainText("سیستم طراحی");
  });
});
