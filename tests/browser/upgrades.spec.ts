import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("offline Geo-IP databases, lookup and graph similarity", async ({
  page,
}) => {
  test.setTimeout(120000);
  const external: string[] = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore sample investigation" })
    .click();
  await expect(
    page.getByText("1668 unique transactions scored locally.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Review all leads" }).click();
  await page.locator("tbody button").first().click();
  await page
    .getByText("Similar transaction structures · graph embeddings", {
      exact: true,
    })
    .click();
  await expect(page.locator(".embedding-matches button")).toHaveCount(5);
  await page.locator(".embedding-matches button").first().click();
  await page
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await page.getByLabel("IP lookup", { exact: true }).fill("8.8.8.8");
  await page
    .getByRole("button", { name: "Load bundled Geo-IP databases" })
    .click();
  await expect(page.getByText("AS15169", { exact: true })).toBeVisible({
    timeout: 90000,
  });
  await expect(
    page.getByRole("cell", { name: "US", exact: true }),
  ).toBeVisible();
  const report = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Geo-IP evidence" }).click();
  const file = await report;
  const path = await file.path();
  const evidence = JSON.parse(fs.readFileSync(path!, "utf8"));
  expect(evidence.databases).toHaveLength(2);
  expect(evidence.results[0].country).toBe("US");
  await page
    .getByLabel("IP lookup", { exact: true })
    .fill("2001:4860:4860::8888");
  await page.getByRole("button", { name: "Look up IPs", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "2001:4860:4860::8888", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("AS15169", { exact: true })).toBeVisible();
  await page.getByLabel("IP lookup", { exact: true }).fill("192.0.2.2");
  await page.getByRole("button", { name: "Look up IPs", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Unavailable", exact: true }),
  ).toHaveCount(2);
  await page.screenshot({
    path: "docs/screenshots/geoip-v2.png",
    fullPage: true,
  });
  expect(external).toEqual([]);
});
