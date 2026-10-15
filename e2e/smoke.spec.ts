import { expect, test, type Page } from "@playwright/test";

// One end-to-end pass over the production build: data loads, WebGL starts, every panel works,
// the CSP is present and nothing logs an error or a CSP violation.

async function open(page: Page, path = "") {
  const problems: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && problems.push(msg.text()));
  page.on("pageerror", (err) => problems.push(err.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(path);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  return problems;
}

test("explore, compare and analogy work on the built site", async ({ page }) => {
  const problems = await open(page);

  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /default-src 'self'/);
  await expect(page.locator("#scene canvas")).toBeVisible();
  await expect(page.locator(".no-webgl")).toHaveCount(0);

  // Search with autocomplete, pick with the keyboard.
  const search = page.getByRole("combobox", { name: "Search a word" });
  await search.fill("kin");
  await expect(page.getByRole("option", { name: "king", exact: true })).toBeVisible();
  await search.fill("king");
  await search.press("Enter");
  await expect(page.locator(".focus-word")).toHaveText("king");
  await expect(page.locator("#tabpanel-explore .score-list li")).toHaveCount(10);
  await expect(page.locator(".word-label:visible")).toHaveCount(11);
  await expect(page).toHaveURL(/#word=king$/);

  // A word outside the vocabulary gets an honest message.
  await search.fill("zzzzq");
  await search.press("Enter");
  await expect(page.locator("#tabpanel-explore .status")).toContainText("is not one of the 5,000 words");

  // Compare.
  await page.getByRole("tab", { name: "Compare" }).click();
  await page.getByRole("button", { name: "good / bad" }).click();
  await expect(page.locator(".big-number")).toHaveText(/^0\.\d{3}$/);
  await expect(page.locator(".compare-result .reading")).toHaveText("related");
  await expect(page.locator(".compare-result")).toContainText("Opposites often score high");

  // Analogy.
  await page.getByRole("tab", { name: "Analogy" }).click();
  await page.getByRole("button", { name: /king − man \+ woman/ }).click();
  await expect(page.locator(".equation strong")).toHaveText("queen");
  await expect(page.locator(".analogy-result .score-list li")).toHaveCount(5);
  await expect(page.locator(".analogy-result")).toContainText('the top answer would be "king"');

  // About shows measured numbers and the licence credit.
  await page.getByRole("tab", { name: "About" }).click();
  await expect(page.locator("#tabpanel-about")).toContainText("Public Domain Dedication and License");

  expect(problems).toEqual([]);
});

test("deep link opens a word, and the phone layout does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const problems = await open(page, "#word=ocean");
  await expect(page.locator(".focus-word")).toHaveText("ocean");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});
