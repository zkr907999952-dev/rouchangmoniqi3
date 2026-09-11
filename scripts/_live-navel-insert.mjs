import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForFunction(() => window.__vela && typeof window.__vela.snapArm === "function", { timeout: 25000 });
await page.waitForTimeout(600);
await page.evaluate(() => { window.__vela.setPose("navelPoke"); });
await page.waitForTimeout(400);
const ins = {
  R_Shoulder_a: [-0.232, 0.328, -0.108],
  R_UpperArm_a: [-0.989, -0.732, 0.443],
  R_Forearm_a: [1.415, -0.438, 0.791],
  R_Hand_a: [0.792, -0.614, 0.244],
  R_Index_a: [0.306, -0.281, -0.044],
};
const d = await page.evaluate((e) => window.__vela.snapArm(e), ins);
const ic = d.bones.R_Index_c;
const n = d.navel;
console.log("INSERT snap");
console.log("  Index_c", ic.map(x=>+x.toFixed(3)));
console.log("  navel  ", n.map(x=>+x.toFixed(3)));
console.log("  ic-navel", ic.map((x,i)=>+(x-n[i]).toFixed(3)));
console.log("  dir", d.fingerDir.map(x=>+x.toFixed(3)));
console.log("  Hand", d.bones.R_Hand_a.map(x=>+x.toFixed(3)));
console.log("  Forearm", d.bones.R_Forearm_a.map(x=>+x.toFixed(3)));
await browser.close();
