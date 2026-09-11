import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(25000);
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForFunction(() => window.__vela && typeof window.__vela.setPose === "function", { timeout: 25000 });
await page.waitForTimeout(600);
for (const insert of [0, 1]) {
  const dump = await page.evaluate((t) => {
    window.__vela.setPose("navelPoke");
    window.__vela.setNavelInsert(t);
    return new Promise((r) => setTimeout(() => r(window.__vela.dumpArm()), 900));
  }, insert);
  console.log("INSERT", insert);
  console.log(JSON.stringify(dump, null, 2));
}
await browser.close();
