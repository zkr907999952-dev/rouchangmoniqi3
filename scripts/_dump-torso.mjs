import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForFunction(
  () => window.__vela && window.__vela.setPose && window.__vela.bodyDebug && window.__vela.frameFigure,
  { timeout: 60000 },
);
await page.waitForTimeout(500);

async function dump(pose, mode, file) {
  await page.evaluate((p) => window.__vela.setPose(p), pose);
  await page.waitForTimeout(280);
  await page.evaluate((m) => window.__vela.frameFigure(m), mode);
  await page.waitForTimeout(520);
  const d = await page.evaluate((p) => {
    const b = window.__vela.bodyDebug();
    return {
      pose: p,
      torso: b.torso,
      navel: b.navel,
      head: b.loco.head,
      hip: b.loco.bones.C_Hip_a,
      L: b.loco.bones.L_UpperLeg_a,
      R: b.loco.bones.R_UpperLeg_a,
    };
  }, pose);
  if (file) await page.screenshot({ path: file });
  console.log(pose, JSON.stringify(d));
  return d;
}

await dump("idle", "walk", "/workspace/screenshots/pose-idle-close.png");
await dump("walk", "walk", "/workspace/screenshots/pose-walk.png");
await dump("squat", "crouch", "/workspace/screenshots/pose-squat.png");
await dump("crouchWalk", "crouch", "/workspace/screenshots/pose-crouch-walk.png");
await dump("crawl", "crawl", "/workspace/screenshots/pose-crawl.png");

await browser.close();
