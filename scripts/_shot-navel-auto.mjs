import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (err) => console.error("pageerror", err.message));
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(
    () => window.__vela && typeof window.__vela.setPose === "function" && typeof window.__vela.dumpArm === "function",
    { timeout: 25000 },
  );
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    window.__vela.setPose("navelPoke");
    window.__vela.setNavelInsert(1);
    window.__vela.setParam("navelThrust", true);
    window.__vela.setParam("navelThrustSpeed", 1);
    window.__vela.setParam("navelStir", false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    window.__vela.frameBelly && window.__vela.frameBelly();
  });

  const waitLive = async (pred, timeout = 9000) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      last = await page.evaluate(() => window.__vela.dumpArm());
      if (pred(last)) return last;
      await page.waitForTimeout(70);
    }
    return last;
  };

  const shallow = await waitLive((d) => d.navelLiveInsert < 0.62);
  await page.evaluate(() => window.__vela.frameBelly && window.__vela.frameBelly());
  const canvas0 = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
  writeFileSync("/workspace/screenshots/navel-thrust-out.png", Buffer.from(canvas0.split(",")[1], "base64"));
  console.log("shallow", shallow?.navelLiveInsert, shallow?.navelThrust, shallow?.bones?.R_Index_c);

  const deep = await waitLive((d) => d.navelLiveInsert > 0.92, 8000);
  await page.evaluate(() => window.__vela.frameBelly && window.__vela.frameBelly());
  const canvas1 = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
  writeFileSync("/workspace/screenshots/navel-thrust-in.png", Buffer.from(canvas1.split(",")[1], "base64"));
  console.log("deep", deep?.navelLiveInsert, deep?.bones?.R_Index_c);

  await page.evaluate(() => {
    window.__vela.setParam("navelThrust", false);
    window.__vela.setNavelInsert(1);
    window.__vela.setParam("navelStir", true);
    window.__vela.setParam("navelStirRadius", 1);
    window.__vela.setParam("navelStirSpeed", 0.7);
  });
  await page.waitForTimeout(800);
  const stir = await page.evaluate(() => window.__vela.dumpArm());
  const canvas2 = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
  writeFileSync("/workspace/screenshots/navel-stir.png", Buffer.from(canvas2.split(",")[1], "base64"));
  console.log("stir", stir.navelLiveInsert, stir.bones?.R_Index_c);
} finally {
  await browser.close();
}
