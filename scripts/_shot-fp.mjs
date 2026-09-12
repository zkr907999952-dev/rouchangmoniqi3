import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function waitReady(page) {
  await page.waitForFunction(
    () =>
      window.__vela &&
      typeof window.__vela.setFirstPerson === "function" &&
      !document.body.innerText.includes("载入模型"),
    { timeout: 45000 },
  );
  await page.waitForTimeout(600);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitReady(page);

  await page.evaluate(() => {
    const btn = document.querySelector('[aria-label="摄像机"]');
    if (btn instanceof HTMLElement) btn.click();
  });
  await page.waitForTimeout(350);
  writeFileSync("/workspace/screenshots/fp-cam-menu.png", await page.screenshot({ type: "png" }));
  console.log("wrote fp-cam-menu");

  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const fp = btns.find((b) => /第一人称/.test(b.textContent || ""));
    if (fp) fp.click();
    else window.__vela.setFirstPerson(true);
  });
  await page.waitForTimeout(500);
  writeFileSync("/workspace/screenshots/fp-cam-menu-on.png", await page.screenshot({ type: "png" }));

  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const close = btns.find((b) => b.textContent?.trim() === "关闭");
    if (close) close.click();
  });
  await page.evaluate(() => window.__controlsTest?.setKeys?.(["KeyW"]));
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__controlsTest?.setKeys?.([]));
  writeFileSync("/workspace/screenshots/fp-view.png", await page.screenshot({ type: "png" }));
  console.log("wrote fp-view", await page.evaluate(() => window.__controlsTest?.getPos?.()));

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await mobile.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitReady(mobile);
  await mobile.evaluate(() => window.__vela.setFirstPerson(true));
  await mobile.waitForTimeout(700);
  writeFileSync("/workspace/screenshots/fp-mobile.png", await mobile.screenshot({ type: "png" }));
  console.log("wrote fp-mobile");
} finally {
  await browser.close();
}
