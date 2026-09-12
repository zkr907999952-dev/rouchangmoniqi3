import { chromium } from "playwright";

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
    window.__vela.setParam("navelThrustSpeed", 0.8);
    window.__vela.setParam("navelStir", false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__vela.frameBelly && window.__vela.frameBelly());
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(180);
    const d = await page.evaluate(() => window.__vela.dumpArm());
    samples.push({
      t: d.navelLiveInsert,
      z: d.bones?.R_Index_c?.[2],
      x: d.bones?.R_Index_c?.[0],
      y: d.bones?.R_Index_c?.[1],
      thrust: d.navelThrust,
    });
  }
  const zs = samples.map((s) => s.z);
  const ts = samples.map((s) => s.t);
  console.log("thrust samples", JSON.stringify({ ts, zs }, null, 2));
  console.log("thrust t range", Math.min(...ts).toFixed(3), Math.max(...ts).toFixed(3));
  console.log("thrust z range", Math.min(...zs).toFixed(4), Math.max(...zs).toFixed(4));

  await page.evaluate(() => {
    window.__vela.setParam("navelThrust", false);
    window.__vela.setNavelInsert(1);
    window.__vela.setParam("navelStir", true);
    window.__vela.setParam("navelStirSpeed", 0.9);
    window.__vela.setParam("navelStirRadius", 1);
  });
  await page.waitForTimeout(300);
  const stir = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(180);
    const d = await page.evaluate(() => window.__vela.dumpArm());
    stir.push({
      t: d.navelLiveInsert,
      x: d.bones?.R_Index_c?.[0],
      y: d.bones?.R_Index_c?.[1],
      z: d.bones?.R_Index_c?.[2],
    });
  }
  const xs = stir.map((s) => s.x);
  const ys = stir.map((s) => s.y);
  console.log("stir samples", JSON.stringify(stir, null, 2));
  console.log("stir x range", Math.min(...xs).toFixed(4), Math.max(...xs).toFixed(4), "span", (Math.max(...xs) - Math.min(...xs)).toFixed(4));
  console.log("stir y range", Math.min(...ys).toFixed(4), Math.max(...ys).toFixed(4), "span", (Math.max(...ys) - Math.min(...ys)).toFixed(4));
} finally {
  await browser.close();
}
