import { expect, test } from "@playwright/test";

// With WebGL switched off, the 3D view is replaced by a notice and every panel still works,
// because no score depends on the 3D scene.

test.use({ launchOptions: { args: ["--disable-3d-apis", "--disable-webgl"] } });

test("panels work without WebGL", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(() => localStorage.setItem("embedscape.seenIntro", "1"));
  await page.goto("");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".no-webgl")).toBeVisible();

  await page.keyboard.press("/");
  await expect(page.getByRole("combobox", { name: "Search a word" })).toBeFocused();
  await page.keyboard.type("coffee");
  await page.keyboard.press("Enter");
  await expect(page.locator("#tabpanel-explore .score-list li")).toHaveCount(10);

  await page.getByRole("tab", { name: "Word maths" }).click();
  await page.getByRole("button", { name: /paris − france \+ japan/ }).click();
  await expect(page.locator(".equation strong")).toHaveText("tokyo");
  expect(errors).toEqual([]);
});
