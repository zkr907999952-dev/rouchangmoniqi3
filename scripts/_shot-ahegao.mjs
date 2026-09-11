import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (err) => console.error("pageerror", err.message));
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(8000);
  const n = await page.locator("canvas").count();
  console.log("canvas count", n);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "8", bubbles: true }));
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
  });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const data = c ? c.toDataURL("image/png") : "";
    return {
      data,
      btns: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean),
    };
  });
  console.log("btns", info.btns);
  if (!info.data.includes(",")) throw new Error("no canvas data");
  writeFileSync("/workspace/screenshots/pose-ahegao.png", Buffer.from(info.data.split(",")[1], "base64"));
  console.log("wrote", info.data.length);
} finally {
  await browser.close();
}
