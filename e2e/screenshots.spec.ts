import { expect, test, type Page } from "@playwright/test";

// Captures the README screenshots from the real production build.
// Skipped by default; run with:  SCREENSHOTS=1 npx playwright test screenshots

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture README screenshots");

const OUT = "docs/screenshots";

async function ready(page: Page, path = "") {
  await page.goto(path);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}

// Let the camera flight (1.2 s) and fades settle before capturing.
const settle = (page: Page) => page.waitForTimeout(2200);

test("desktop screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await ready(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/overview.png` });

  await ready(page, "#word=ocean");
  await settle(page);
  await page.screenshot({ path: `${OUT}/explore-ocean.png` });

  await page.getByRole("tab", { name: "Compare" }).click();
  await page.getByRole("button", { name: "good / bad" }).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/compare.png` });

  await page.getByRole("tab", { name: "Analogy" }).click();
  await page.getByRole("button", { name: /doctor − man \+ woman/ }).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/analogy-bias.png` });
});

test("phone screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "#word=music");
  await settle(page);
  await page.screenshot({ path: `${OUT}/phone.png` });
});
