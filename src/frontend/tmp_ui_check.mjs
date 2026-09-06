import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleMessages = [];
const failedRequests = [];
const apiResponses = [];
const stylesheetResponses = [];

page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`));
page.on("response", (response) => {
  if (response.url().includes("/api/v1/")) apiResponses.push(`${response.status()} ${response.url()}`);
  if (response.request().resourceType() === "stylesheet") stylesheetResponses.push(`${response.status()} ${response.url()}`);
});

await page.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
console.log(`title=${await page.title()}`);
console.log(`textarea=${await page.locator("textarea").count()} buttons=${await page.locator("button").count()}`);
console.log(`bodyChars=${(await page.locator("body").innerText()).length}`);
await page.screenshot({ path: "ui-check.png", fullPage: true });

const textarea = page.locator("textarea");
await textarea.fill("Mình tên là Hiếu");
const sendButton = page.locator("button.send-trigger");
console.log(`sendDisabled=${await sendButton.isDisabled()}`);
if (!(await sendButton.isDisabled())) {
  await sendButton.click();
  await page.waitForTimeout(1500);
}
console.log(`afterSubmitError=${await page.locator('[role="alert"]').count()}`);
console.log(`alertText=${JSON.stringify(await page.locator('[role="alert"]').allTextContents())}`);
console.log(`bodyHasHiếu=${(await page.locator("body").innerText()).includes("Hiếu")}`);
console.log(`bodyText=${JSON.stringify((await page.locator("body").innerText()).slice(-900))}`);
console.log(`console=${JSON.stringify(consoleMessages)}`);
console.log(`failedRequests=${JSON.stringify(failedRequests)}`);
console.log(`apiResponses=${JSON.stringify(apiResponses)}`);
console.log(`stylesheetResponses=${JSON.stringify(stylesheetResponses)}`);

await browser.close();
