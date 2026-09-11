import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForFunction(() => window.__vela && typeof window.__vela.snapArm === "function", { timeout: 25000 });
await page.waitForTimeout(800);

await page.evaluate(() => {
  window.__vela.setPose("navelPoke");
  window.__vela.setNavelInsert(0);
});
await page.waitForTimeout(500);

const original = {
  R_Shoulder_a: [-0.229, 0.313, -0.159],
  R_UpperArm_a: [-1.321, -0.653, 0.219],
  R_Forearm_a: [1.512, -0.459, 0.719],
  R_Hand_a: [0.787, -0.386, 0.579],
  R_Index_a: [0, 0, 0],
};
const neu = {
  R_Shoulder_a: [-0.232, 0.327, -0.098],
  R_UpperArm_a: [-1.12, -0.726, 0.367],
  R_Forearm_a: [1.07, -0.431, 0.617],
  R_Hand_a: [1.096, -0.72, 0.438],
  R_Index_a: [0.413, -0.363, -0.009],
};

const d1 = await page.evaluate((e) => window.__vela.snapArm(e), original);
console.log("ORIGINAL snap", JSON.stringify({ bones: d1.bones, fingerDir: d1.fingerDir, navel: d1.navel }, null, 2));

const d2 = await page.evaluate((e) => window.__vela.snapArm(e), neu);
console.log("NEW snap", JSON.stringify({ bones: d2.bones, fingerDir: d2.fingerDir, navel: d2.navel }, null, 2));

await browser.close();
