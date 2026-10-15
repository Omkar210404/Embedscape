import { expect, test, type Page } from "@playwright/test";

// Captures the README screenshots from the real production build.
// Skipped by default; run with:  SCREENSHOTS=1 npx playwright test screenshots

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture README screenshots");

const OUT = "docs/screenshots";

async function ready(page: Page, path = "", seenIntro = true) {
  await page.addInitScript((seen) => seen && localStorage.setItem("embedscape.seenIntro", "1"), seenIntro);
  await page.goto(path);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}

// Let camera flights and fades settle before capturing.
const settle = (page: Page, ms = 2200) => page.waitForTimeout(ms);

test("desktop screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await ready(page, "", false);
  await settle(page, 4200); // intro fly-in
  await page.screenshot({ path: `${OUT}/intro.png` });
  await page.getByRole("button", { name: "Explore on my own" }).click();
  await settle(page, 600);
  await page.screenshot({ path: `${OUT}/overview.png` });

  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next" }).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/tour-analogy.png` });
  await page.getByRole("button", { name: "End tour" }).click();

  await page.getByRole("combobox", { name: "Search a word" }).fill("ocean");
  await page.getByRole("combobox", { name: "Search a word" }).press("Enter");
  await settle(page);
  await page.screenshot({ path: `${OUT}/explore-ocean.png` });

  await page.getByRole("tab", { name: "Compare two words" }).click();
  await page.getByRole("button", { name: "good / bad" }).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/compare.png` });

  await page.getByRole("tab", { name: "Word maths" }).click();
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
