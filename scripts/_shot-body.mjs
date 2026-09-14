import { chromium } from "playwright";
import { mkdirSync } from "fs";

mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(50000);
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(
    () => window.__vela && window.__vela.setFpView && window.__controlsTest,
    { timeout: 60000 },
  );
  await page.waitForTimeout(600);

  // observe still works
  await page.evaluate(() => window.__vela.setFirstPerson(true, "observe"));
  await page.waitForTimeout(300);
  const obs0 = await page.evaluate(() => window.__controlsTest.getPos());
  await page.evaluate(() => window.__controlsTest.setKeys(["KeyW"]));
  await page.waitForTimeout(500);
  const obs1 = await page.evaluate(() => window.__controlsTest.getPos());
  await page.evaluate(() => window.__controlsTest.setKeys([]));
  const obsDz = obs1[2] - obs0[2];
  if (obsDz >= -0.02) throw new Error("observe W should go -Z, dz=" + obsDz);
  console.log("observe W ok", obsDz.toFixed(3));

  // body view
  await page.evaluate(() => window.__vela.setFpView("body"));
  await page.waitForFunction(
    () => window.__vela.bodyDebug?.().headReady && window.__vela.bodyDebug().hide.length >= 2,
    { timeout: 8000 },
  );
  const dbg0 = await page.evaluate(() => window.__vela.bodyDebug());
  console.log("body enter", JSON.stringify(dbg0));
  if (dbg0.hideCount < 2) throw new Error("expected head/hair hide meshes");
  if (dbg0.hide.length < 2) throw new Error("head/hair should be hidden in body view");
  if (dbg0.cam[1] < 1.1 || dbg0.cam[1] > 1.85) throw new Error("cam not at head, y=" + dbg0.cam[1]);

  const start = await page.evaluate(() => ({
    pos: window.__controlsTest.getPos(),
    cam: window.__vela.bodyDebug().cam,
    root: window.__vela.bodyDebug().root,
  }));
  await page.evaluate(() => window.__controlsTest.setKeys(["KeyW"]));
  await page.waitForTimeout(700);
  const w = await page.evaluate(() => ({
    pos: window.__controlsTest.getPos(),
    cam: window.__vela.bodyDebug().cam,
    root: window.__vela.bodyDebug().root,
    speed: window.__controlsTest.getSpeed(),
  }));
  await page.evaluate(() => window.__controlsTest.setKeys([]));
  const dz = w.pos[2] - start.pos[2];
  const dCamZ = w.cam[2] - start.cam[2];
  const dRootZ = w.root[2] - start.root[2];
  if (w.speed <= 0.15) throw new Error("body W: no speed " + w.speed);
  if (dz <= 0.02) throw new Error("body W: should move +Z (facing +Z), dz=" + dz);
  if (dRootZ <= 0.02) throw new Error("body W: character root should follow, dRootZ=" + dRootZ);
  if (dCamZ <= 0.02) throw new Error("body W: camera should follow, dCamZ=" + dCamZ);
  console.log("body W ok", { dz: +dz.toFixed(3), dRootZ: +dRootZ.toFixed(3), dCamZ: +dCamZ.toFixed(3) });

  await page.evaluate(() => window.__controlsTest.setLook(Math.PI, -1.15));
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/workspace/screenshots/fp-body-down.png" });
  await page.evaluate(() => window.__controlsTest.setLook(Math.PI, -0.68));
  await page.waitForTimeout(250);
  await page.screenshot({ path: "/workspace/screenshots/fp-body-view.png" });

  const mid = await page.evaluate(() => window.__controlsTest.getPos());
  await page.evaluate(() => window.__controlsTest.setKeys(["KeyA"]));
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => window.__controlsTest.getPos());
  await page.evaluate(() => window.__controlsTest.setKeys([]));
  const dxA = a[0] - mid[0];
  if (dxA <= 0.01) throw new Error("body A: facing +Z, A should strafe +X (left), dx=" + dxA);
  console.log("body A ok", dxA.toFixed(3));

  await page.screenshot({ path: "/workspace/screenshots/fp-cam-menu-body.png" });
  console.log("PASS");
} catch (err) {
  console.error("FAIL", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
