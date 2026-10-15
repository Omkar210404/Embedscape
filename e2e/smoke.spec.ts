import { expect, test, type Page } from "@playwright/test";

// End-to-end passes over the production build: data loads, WebGL starts, the intro and tour
// explain the idea, every tool works, the CSP is present and nothing logs an error or violation.

async function open(page: Page, path = "", { seenIntro = true } = {}) {
  const problems: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && problems.push(msg.text()));
  page.on("pageerror", (err) => problems.push(err.message));
  await page.addInitScript((seen) => {
    if (seen) localStorage.setItem("embedscape.seenIntro", "1");
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  }, seenIntro);
  await page.goto(path);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  return problems;
}

test("first visit explains the idea and the tour walks through it", async ({ page }) => {
  const problems = await open(page, "", { seenIntro: false });

  const intro = page.getByRole("dialog", { name: /Every dot is a word/ });
  await expect(intro).toBeVisible();
  await page.getByRole("button", { name: "Take the 1-minute tour" }).click();
  await expect(intro).toBeHidden();

  const tour = page.getByRole("region", { name: "Each glowing dot is a word" });
  await expect(tour).toBeVisible();
  const next = page.getByRole("button", { name: "Next" });

  await next.click();
  await expect(page.locator(".tour-title")).toHaveText("Similar words live together");
  await expect(page.locator(".focus-word")).toHaveText("france");

  await next.click();
  await expect(page.locator(".tour-body")).toContainText("“cat” and “dog” score 0.921");
  await expect(page.locator(".big-number")).toHaveText("0.921");

  await next.click();
  await expect(page.locator(".tour-body")).toContainText("the nearest word is “queen”");
  await expect(page.locator(".equation strong")).toHaveText("queen");

  await next.click();
  await expect(page.locator(".tour-title")).toHaveText("It learned our biases too");
  await next.click();
  await page.getByRole("button", { name: "Start exploring" }).click();
  await expect(page.locator(".tour")).toBeHidden();

  // The intro is not shown again once seen.
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.waitForTimeout(1200);
  await expect(page.locator("#intro")).not.toHaveAttribute("open", "");
  expect(problems).toEqual([]);
});

test("explore, compare and word maths work on the built site", async ({ page }) => {
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
  await expect(page.locator(".word-label:not(.is-near):visible")).toHaveCount(11);
  await expect(page).toHaveURL(/#word=king$/);

  // A word outside the vocabulary gets an honest message.
  await search.fill("zzzzq");
  await search.press("Enter");
  await expect(page.locator("#search-status")).toContainText("is not one of the 5,000 words");

  // Closing the card returns to the open map.
  await page.locator("#card-close").click();
  await expect(page.locator("#card")).toBeHidden();

  // Compare.
  await page.getByRole("tab", { name: "Compare two words" }).click();
  await page.getByRole("button", { name: "good / bad" }).click();
  await expect(page.locator(".big-number")).toHaveText(/^0\.\d{3}$/);
  await expect(page.locator(".compare-result .reading")).toHaveText("related");
  await expect(page.locator(".compare-result")).toContainText("Opposites often score high");

  // Word maths.
  await page.getByRole("tab", { name: "Word maths" }).click();
  await page.getByRole("button", { name: /king − man \+ woman/ }).click();
  await expect(page.locator(".equation strong")).toHaveText("queen");
  await expect(page.locator(".analogy-result .score-list li")).toHaveCount(5);
  await expect(page.locator(".analogy-result")).toContainText('the top answer would be "king"');

  // Method and limits, with the licence credit.
  await page.getByRole("button", { name: "Method & limits" }).click();
  await expect(page.locator("#about")).toContainText("Public Domain Dedication and License");
  await page.locator("#about-close").click();

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
