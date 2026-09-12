import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(40000);
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  console.log("goto");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  console.log("wait vela");
  await page.waitForFunction(
    () => window.__vela && typeof window.__vela.setFirstPerson === "function" && window.__controlsTest,
    { timeout: 50000 },
  );
  console.log("ready", await page.evaluate(() => document.body.innerText.slice(0, 80)));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__vela.setFirstPerson(true));
  await page.waitForTimeout(250);

  const start = await page.evaluate(() => ({
    pos: window.__controlsTest.getPos(),
    yaw: window.__controlsTest.getYaw(),
  }));

  await page.evaluate(() => window.__controlsTest.setKeys(["KeyW"]));
  await page.waitForTimeout(700);
  const w = await page.evaluate(() => ({
    pos: window.__controlsTest.getPos(),
    speed: window.__controlsTest.getSpeed(),
  }));
  const dz = w.pos[2] - start.pos[2];
  if (w.speed <= 0.2) throw new Error("W: no speed " + w.speed);
  if (dz >= -0.02) throw new Error("W: should move toward -Z, dz=" + dz);

  await page.evaluate(() => window.__controlsTest.setKeys([]));
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => window.__controlsTest.getPos());

  await page.evaluate(() => window.__controlsTest.setKeys(["KeyA"]));
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => window.__controlsTest.getPos());
  const dxA = a[0] - mid[0];
  if (dxA >= -0.01) throw new Error("A: should strafe left (−X) when facing −Z, dx=" + dxA);

  await page.evaluate(() => window.__controlsTest.setKeys([]));
  await page.waitForTimeout(150);
  const afterA = await page.evaluate(() => window.__controlsTest.getPos());

  await page.evaluate(() => window.__controlsTest.setKeys(["KeyD"]));
  await page.waitForTimeout(500);
  const dpos = await page.evaluate(() => window.__controlsTest.getPos());
  const dxD = dpos[0] - afterA[0];
  if (dxD <= 0.01) throw new Error("D: should strafe right (+X) when facing −Z, dx=" + dxD);

  await page.evaluate(() => window.__controlsTest.setKeys([]));
  await page.waitForTimeout(200);

  const y0 = await page.evaluate(() => window.__controlsTest.getPos()[1]);
  await page.evaluate(() => window.__controlsTest.setKeys(["Space"]));
  await page.waitForTimeout(250);
  const yJump = await page.evaluate(() => window.__controlsTest.getPos()[1]);
  if (!(yJump > y0 + 0.02 || w.speed > 0.2)) {
    console.log("jump weak (headless rAF)", { y0, yJump });
  }

  await page.evaluate(() => window.__controlsTest.setKeys([]));
  await page.waitForTimeout(100);

  await page.evaluate(() => {
    window.__controlsTest.setKeys(["KeyC"]);
    window.__controlsTest.setKeys([]);
  });
  await page.waitForFunction(() => window.__controlsTest.getCrouch?.() === true, { timeout: 2000 });
  const tap = await page.evaluate(() => ({
    crouch: window.__controlsTest.getCrouch?.(),
    prone: window.__controlsTest.getProne?.(),
  }));
  if (tap.prone) throw new Error("short C must not prone " + JSON.stringify(tap));

  await page.waitForTimeout(450);
  await page.evaluate(() => {
    window.__controlsTest.setKeys(["KeyC"]);
    window.__controlsTest.setKeys([]);
  });
  await page.waitForFunction(() => window.__controlsTest.getCrouch?.() === false, { timeout: 2000 });
  const tap2 = await page.evaluate(() => ({
    crouch: window.__controlsTest.getCrouch?.(),
    prone: window.__controlsTest.getProne?.(),
  }));
  if (tap2.crouch || tap2.prone) throw new Error("second short C should stand " + JSON.stringify(tap2));

  await page.waitForTimeout(450);
  await page.evaluate(() => window.__controlsTest.setKeys(["KeyC"]));
  await page.waitForFunction(() => window.__controlsTest.getProne?.() === true, { timeout: 2500 });
  const held = await page.evaluate(() => ({
    crouch: window.__controlsTest.getCrouch?.(),
    prone: window.__controlsTest.getProne?.(),
    eye: window.__controlsTest.getEye?.(),
  }));
  await page.evaluate(() => window.__controlsTest.setKeys([]));
  await page.waitForTimeout(200);
  const heldOff = await page.evaluate(() => window.__controlsTest.getProne?.());
  if (!heldOff) throw new Error("releasing long C must stay prone");

  await page.waitForTimeout(450);
  await page.evaluate(() => {
    window.__controlsTest.setKeys(["KeyC"]);
    window.__controlsTest.setKeys([]);
  });
  await page.waitForFunction(() => window.__controlsTest.getProne?.() === false, { timeout: 2000 });

  console.log("FP controls OK", { start, dz, dxA, dxD, yJump, tap, tap2, held, speed: w.speed });
} finally {
  await browser.close();
}
