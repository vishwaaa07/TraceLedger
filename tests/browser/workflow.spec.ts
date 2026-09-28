import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
test("complete offline workbench journey", async ({ page, context }) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Explore sample investigation" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Explore sample investigation" })
    .click();
  await expect(
    page.getByText("170 unique transactions scored locally.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review all leads" }).click();
  await page.locator("tbody button").first().click();
  await expect(
    page.getByRole("heading", { name: "Supporting observations" }),
  ).toBeVisible();
  await expect(page.getByLabel("Automatic analyst summary")).toContainText("Suggested checks");
  await expect(page.getByLabel("Automatic analyst summary")).toContainText("fixed guidance rules");
  await page
    .getByLabel("Analyst notes")
    .fill("Reviewed synthetic lead; verify source evidence.");
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("reviewed");
  await page
    .getByText("Source records and provenance", { exact: true })
    .click();
  await expect(page.locator("#alert-detail pre")).toContainText("provenance");
  await page.screenshot({ path: "docs/screenshots/alert.png", fullPage: true });
  await page.getByRole("button", { name: "Inspect in graph" }).click();
  await expect(page.locator(".graph canvas").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshots/graph.png", fullPage: true });
  const graphDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export visible graph" }).click();
  const graph = await graphDownload;
  await graph.saveAs("test-results/graph.json");
  expect(
    JSON.parse(fs.readFileSync("test-results/graph.json", "utf8")).elements
      .length,
  ).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Investigations", exact: false })
    .click();
  await page.getByRole("button", { name: "Save case locally" }).click();
  await expect(
    page.getByText("Case saved in this browser.", { exact: true }),
  ).toBeVisible();
  const caseDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export case / evidence JSON" })
    .click();
  const file = await caseDownload;
  await file.saveAs("test-results/exported-case.json");
  const exported = JSON.parse(
    fs.readFileSync("test-results/exported-case.json", "utf8"),
  );
  expect(exported.analysis.dataset.transactions.length).toBe(170);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export evidence CSV" }).click();
  await (await csvDownload).saveAs("test-results/evidence.csv");
  expect(fs.readFileSync("test-results/evidence.csv", "utf8")).toContain(
    "dataset_sha256",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "No dataset loaded",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Investigations", exact: false })
    .click();
  await page.getByRole("button", { name: "Restore saved case" }).click();
  await expect(
    page.getByText("Saved case restored.", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Import case", { exact: true })
    .setInputFiles("test-results/exported-case.json");
  await expect(
    page.getByText("Case imported and scores regenerated.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import data", exact: false }).click();
  await page
    .getByLabel("Choose dataset")
    .setInputFiles(path.resolve("public/data/sample.csv"));
  await expect(
    page.getByRole("button", { name: "Validate mapped data" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Validate mapped data" }).click();
  await expect(
    page.getByText("Validation complete. 170 unique valid transactions."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(
    page.getByText("170 unique transactions scored locally.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import data", exact: false }).click();
  await page
    .getByLabel("Choose dataset")
    .setInputFiles(path.resolve("public/data/malformed.json"));
  await page.getByRole("button", { name: "Validate mapped data" }).click();
  await expect(
    page.getByText("Validation complete. 0 unique valid transactions."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run analysis", exact: true }),
  ).toBeDisabled();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "docs/offline-browser-evidence.json",
    JSON.stringify(
      {
        platform: process.platform,
        externalRequests: external,
        pageErrors: errors,
        mode: "fresh browser context; non-loopback HTTP requests aborted; static dist served by Python",
        transactions: 170,
        sourceRecords: 306,
        analysisMilliseconds: exported.analysis.elapsedMs,
        model: exported.analysis.modelVersion,
      },
      null,
      2,
    ),
  );
});
test("mobile layout and storage failure preserve export", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get: () => {
        throw Error("Storage disabled for test");
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore sample investigation" })
    .click();
  await expect(
    page.getByText("170 unique transactions scored locally.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Investigations", exact: false })
    .click();
  await page.getByRole("button", { name: "Save case locally" }).click();
  await expect(page.getByRole("alert")).toContainText("Storage disabled");
  const d = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export case / evidence JSON" })
    .click();
  expect((await d).suggestedFilename()).toContain("case");
});

test("graph controls, exposure, XML and unknown Geo-IP", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore sample investigation" })
    .click();
  await expect(
    page.getByText("170 unique transactions scored locally.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Graph explorer", exact: false })
    .click();
  await expect(
    page.getByLabel("Inspect visible entity").locator("option"),
  ).not.toHaveCount(1);
  const txOption = await page
    .getByLabel("Inspect visible entity")
    .locator('option[value^="t:"]')
    .first()
    .getAttribute("value");
  await page.getByLabel("Inspect visible entity").selectOption(txOption!);
  await expect(
    page.getByRole("heading", { name: "Selected transaction" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand neighbourhood" }).click();
  await page.getByText("Filter by type or date", { exact: true }).click();
  await page.getByLabel("Relationship", { exact: true }).selectOption("spend");
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.getByLabel("Graph search").fill("192.0.2.2");
  await page.getByRole("button", { name: "Find entity" }).click();
  await page.getByLabel("Inspect visible entity").selectOption("ip:192.0.2.2");
  await expect(
    page.getByText("Geo-IP unavailable", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Investigations", exact: false })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "Trace from an address" })
    .click();
  await page.getByRole("button", { name: "Use synthetic seed" }).click();
  await page.getByRole("button", { name: "Calculate exposure" }).click();
  await expect(
    page.getByText("Exposure recalculated from supplied seed."),
  ).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.getByRole("button", { name: "Print report" }).evaluate((el) => {
    el.setAttribute("data-print-test", "ready");
  });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-report")).toBeVisible();
  await page.pdf({
    path: "docs/screenshots/report.pdf",
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Import data", exact: false }).click();
  await page
    .getByLabel("Choose dataset")
    .setInputFiles("public/data/sample.xml");
  await page.getByRole("button", { name: "Validate mapped data" }).click();
  await expect(
    page.getByText("Validation complete. 170 unique valid transactions."),
  ).toBeVisible();
  const d = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download validation report" })
    .click();
  expect((await d).suggestedFilename()).toBe("validation-report.json");
  await page.getByLabel("Choose dataset").setInputFiles({
    name: "unsafe.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(
      '<!DOCTYPE records [<!ENTITY a SYSTEM "file:///etc/passwd">]><records/>',
    ),
  });
  await expect(page.getByRole("alert")).toContainText("Unsafe XML");
});

test("missing model is an actionable error", async ({ page }) => {
  await page.route("**/model/isolation-forest.json", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Cannot load required model assets",
  );
  await expect(
    page.getByRole("button", { name: "Explore sample investigation" }),
  ).toBeDisabled();
});

test("dashboard queue and neighbourhood interactions", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: "docs/screenshots/start.png", fullPage: true });
  await page
    .getByRole("button", { name: "Explore sample investigation" })
    .click();
  await expect(page.locator(".network-center")).toBeVisible();
  const initial = await page.locator(".network-center").innerText();
  await page
    .getByRole("button", { name: "Next transaction neighbourhood" })
    .click();
  await expect(page.locator(".network-center")).not.toHaveText(initial);
  await page.getByRole("button", { name: "Reviewed", exact: true }).click();
  await expect(
    page.getByText("No reviewed leads.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unreviewed", exact: true }).click();
  await page.locator(".queue-row").first().click();
  await expect(
    page.getByRole("heading", { name: "Supporting observations" }),
  ).toBeVisible();
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("reviewed");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Reviewed", exact: true }).click();
  await expect(page.locator(".queue-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Open graph" }).click();
  await expect(page.locator(".graph canvas").first()).toBeVisible();
});

test("simplified model and case pages", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("SAMPLE CASE / 042", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Explore sample investigation" })
    .click();
  await expect(
    page.getByText("170 unique transactions scored locally.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Save or resume a case" }),
  ).toBeVisible();
  await expect(page.locator(".header-status")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save case locally" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Seed address", { exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/investigations.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "How the model works" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reading an alert" }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/model.png", fullPage: true });
  await page
    .getByText("Training details and downloads", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download model", exact: true }),
  ).toBeVisible();
});

test("theme, sticky navigation and transaction summaries", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Scale lab", exact: true }),
  ).toHaveCount(0);
  await page.locator(".theme-menu > summary").click();
  await page.locator(".theme-options button").filter({ hasText: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".theme-menu > summary").click();
  await page.locator(".theme-options button").filter({ hasText: "System" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator(".theme-menu > summary").click();
  await page.locator(".theme-options button").filter({ hasText: "Dark" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Explore sample investigation" })
    .click();
  await expect(
    page.getByText("170 unique transactions scored locally.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Loaded dataset · not live", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/dark-overview.png",
    fullPage: true,
  });
  await page.evaluate(() => window.scrollTo(0, 900));
  expect((await page.locator(".topbar").boundingBox())!.y).toBeLessThanOrEqual(
    1,
  );
  await page
    .getByRole("button", { name: "Analyst workspace", exact: true })
    .click();
  await page.locator("tbody button").first().click();
  await expect(
    page.getByRole("heading", { name: "Transaction details", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Analyst notes", { exact: true })
    .fill("Verify related output spends against original records.");
  await expect(page.locator(".connection-list button").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screenshots/analyst-workspace.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect in graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Transaction flow", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".theme-menu > summary").click();
  await page.locator(".theme-options button").filter({ hasText: "Light" }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Download and run on Linux" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/linux-help.png",
    fullPage: true,
  });
});

test("bulk metadata through browser worker", async ({ page }) => {
  test.skip(
    !process.env.TRACE_BULK_FILE,
    "Set TRACE_BULK_FILE to a generated bulk JSON fixture",
  );
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const start = Date.now();
  await page
    .getByLabel("Choose dataset")
    .setInputFiles(process.env.TRACE_BULK_FILE!);
  await expect(
    page.getByRole("button", { name: "Validate mapped data" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Validate mapped data" }).click();
  await expect(
    page.getByRole("button", { name: "Run analysis", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Entity explorer", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(
    page.getByText("12142 matching transactions", { exact: false }),
  ).toBeVisible();
  fs.writeFileSync(
    "docs/bulk-browser.json",
    JSON.stringify(
      {
        browser: await page.context().browser()!.version(),
        elapsedMs: Date.now() - start,
        fixtureBytes: fs.statSync(process.env.TRACE_BULK_FILE!).size,
        workflow:
          "upload, preview, validation, actual worker scoring, analyst table rendering",
      },
      null,
      2,
    ),
  );
});

test('individual output blocks retain their evidence', async ({page}) => {
 await page.goto('/');
 await page.getByRole('button',{name:'Explore sample investigation'}).click();
 await expect(page.getByText('170 unique transactions scored locally.',{exact:false})).toBeVisible();
 await expect(page.getByRole('heading',{name:'AI Powered Bitcoin Transaction Investigation',exact:true})).toBeVisible();
 await expect(page.locator('.individual-connections > path')).toHaveCount(6);
 await page.getByRole('button',{name:'Open graph'}).click();
 const outputs=page.getByLabel('Inspect visible entity').locator('option[value^="outpoint:"]');
 await expect(outputs).toHaveCount(7);
 await page.getByLabel('Inspect visible entity').selectOption((await outputs.first().getAttribute('value'))!);
 await expect(page.getByRole('heading',{name:'Selected output',exact:true})).toBeVisible();
 await page.getByText('View source records',{exact:true}).click();
 await expect(page.locator('pre:visible')).toContainText('17774584');
 await expect(page.locator('pre:visible')).toContainText('parentTx');
});
