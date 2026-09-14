import { chromium } from "playwright";
import { mkdirSync } from "fs";

mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const round = (n) => Math.round(n * 1000) / 1000;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(50000);
  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.log("PAGEERROR", err.message);
  });
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(
    () => window.__vela && window.__vela.setPose && window.__vela.bodyDebug && window.__controlsTest,
    { timeout: 60000 },
  );
  await page.waitForTimeout(700);

  const look = await page.evaluate(() => window.__controlsTest.getLookSpeed?.() ?? window.__vela.bodyDebug()?.lookSpeed);
  console.log("lookSpeed", look);
  if (Math.abs(look - 0.9) > 0.02) throw new Error("fpLookSpeed default should be 0.9, got " + look);

  const shotPose = async (id, mode, file) => {
    await page.evaluate((p) => window.__vela.setPose(p), id);
    await page.waitForTimeout(200);
    await page.evaluate((m) => window.__vela.frameFigure?.(m), mode);
    await page.waitForTimeout(550);
    const dump = await page.evaluate(() => window.__vela.bodyDebug().loco);
    await page.screenshot({ path: file });
    return dump;
  };

  const walk = await shotPose("walk", "walk", "/workspace/screenshots/pose-walk.png");
  console.log("walk", JSON.stringify({
    phase: round(walk.phase),
    headY: walk.head && round(walk.head[1]),
    L: walk.bones.L_UpperLeg_a?.eul.map(round),
    R: walk.bones.R_UpperLeg_a?.eul.map(round),
    armL: walk.bones.L_UpperArm_a?.eul.map(round),
  }));
  if (Math.abs(walk.bones.L_UpperLeg_a.eul[0] - walk.bones.R_UpperLeg_a.eul[0]) < 0.25) {
    throw new Error("walk: legs should be opposite, L=" + walk.bones.L_UpperLeg_a.eul[0] + " R=" + walk.bones.R_UpperLeg_a.eul[0]);
  }

  const cw = await shotPose("crouchWalk", "crouch", "/workspace/screenshots/pose-crouch-walk.png");
  console.log("crouchWalk", JSON.stringify({
    phase: round(cw.phase),
    headY: cw.head && round(cw.head[1]),
    hipY: cw.bones.C_Hip_a?.pos[1] && round(cw.bones.C_Hip_a.pos[1]),
    L: cw.bones.L_UpperLeg_a?.eul.map(round),
  }));
  if (!cw.head || cw.head[1] > 1.2) throw new Error("crouchWalk head should drop, y=" + cw.head?.[1]);

  const crawl = await shotPose("crawl", "crawl", "/workspace/screenshots/pose-crawl.png");
  console.log("crawl", JSON.stringify({
    phase: round(crawl.phase),
    headY: crawl.head && round(crawl.head[1]),
    hipE: crawl.bones.C_Hip_a?.eul.map(round),
    hipY: crawl.bones.C_Hip_a?.pos[1] && round(crawl.bones.C_Hip_a.pos[1]),
  }));
  if (!crawl.head || crawl.head[1] > 0.85) throw new Error("crawl head should be low, y=" + crawl.head?.[1]);
  if (Math.abs(crawl.bones.C_Hip_a.eul[0]) < 0.8) throw new Error("crawl hip should pitch down, x=" + crawl.bones.C_Hip_a.eul[0]);

  await page.evaluate(() => {
    window.__vela.setPose("idle");
    window.__vela.setFirstPerson(true);
    window.__vela.setFpView("body");
    window.__vela.setFpCrouch(false);
    window.__vela.setFpProne(false);
  });
  await page.waitForFunction(() => window.__vela.bodyDebug?.().headReady, { timeout: 8000 });
  await page.waitForTimeout(400);
  const stand = await page.evaluate(() => window.__vela.bodyDebug());
  console.log("stand body", JSON.stringify({
    eye: stand.eye.map(round),
    cam: stand.cam.map(round),
    head: stand.loco.head && stand.loco.head.map(round),
    lookSpeed: stand.lookSpeed,
  }));
  if (stand.lookSpeed < 0.85 || stand.lookSpeed > 0.95) throw new Error("lookSpeed in body " + stand.lookSpeed);
  if (stand.eye[1] < 1.15) throw new Error("stand eye too low " + stand.eye[1]);

  await page.evaluate(() => window.__vela.setFpCrouch(true));
  await page.waitForTimeout(500);
  const crouch = await page.evaluate(() => window.__vela.bodyDebug());
  console.log("crouch body", JSON.stringify({
    eye: crouch.eye.map(round),
    cam: crouch.cam.map(round),
    head: crouch.loco.head && crouch.loco.head.map(round),
    hipY: crouch.loco.bones.C_Hip_a?.pos[1] && round(crouch.loco.bones.C_Hip_a.pos[1]),
  }));
  const drop = stand.eye[1] - crouch.eye[1];
  console.log("crouch drop", round(drop));
  if (drop < 0.22) throw new Error("crouch camera should drop, drop=" + drop);

  await page.evaluate(() => window.__controlsTest.setLook(Math.PI, -0.95));
  await page.waitForTimeout(250);
  await page.screenshot({ path: "/workspace/screenshots/fp-body-crouch.png" });

  await page.evaluate(() => {
    window.__vela.setFpCrouch(false);
    window.__vela.setFpProne(true);
  });
  await page.waitForTimeout(500);
  const prone = await page.evaluate(() => window.__vela.bodyDebug());
  console.log("prone body", JSON.stringify({
    eye: prone.eye.map(round),
    cam: prone.cam.map(round),
    head: prone.loco.head && prone.loco.head.map(round),
    hipE: prone.loco.bones.C_Hip_a?.eul.map(round),
  }));
  if (stand.eye[1] - prone.eye[1] < 0.45) {
    throw new Error("prone camera should drop a lot, stand=" + stand.eye[1] + " prone=" + prone.eye[1]);
  }
  await page.evaluate(() => window.__controlsTest.setLook(Math.PI, -0.35));
  await page.waitForTimeout(250);
  await page.screenshot({ path: "/workspace/screenshots/fp-body-prone.png" });

  await page.evaluate(() => {
    window.__vela.setFpProne(false);
    window.__vela.setFpCrouch(false);
    window.__controlsTest.setLook(Math.PI, -0.85);
  });
  await page.waitForTimeout(250);

  const sampleDir = async (keys, label) => {
    await page.evaluate((c) => window.__controlsTest.setKeys(c), keys);
    await page.waitForTimeout(380);
    const d = await page.evaluate(() => window.__vela.bodyDebug());
    await page.screenshot({ path: `/workspace/screenshots/fp-body-move-${label}.png` });
    await page.evaluate(() => window.__controlsTest.setKeys([]));
    await page.waitForTimeout(80);
    return {
      label,
      move: d.move,
      phase: round(d.loco.phase),
      L: d.loco.bones.L_UpperLeg_a?.eul.map(round),
      R: d.loco.bones.R_UpperLeg_a?.eul.map(round),
      armL: d.loco.bones.L_UpperArm_a?.eul.map(round),
      armR: d.loco.bones.R_UpperArm_a?.eul.map(round),
      hip: d.loco.bones.C_Hip_a?.eul.map(round),
    };
  };

  const w = await sampleDir(["KeyW"], "w");
  const s = await sampleDir(["KeyS"], "s");
  const a = await sampleDir(["KeyA"], "a");
  const dd = await sampleDir(["KeyD"], "d");
  console.log("dirs", JSON.stringify({ w, s, a, d: dd }));
  if (Math.abs(w.move[0]) > 0.2 || w.move[1] < 0.8) throw new Error("W should be fwd, move=" + w.move);
  if (Math.abs(s.move[0]) > 0.2 || s.move[1] > -0.8) throw new Error("S should be back, move=" + s.move);
  if (a.move[0] > -0.8 || Math.abs(a.move[1]) > 0.2) throw new Error("A should be left, move=" + a.move);
  if (dd.move[0] < 0.8 || Math.abs(dd.move[1]) > 0.2) throw new Error("D should be right, move=" + dd.move);
  if (Math.abs(a.L[2] - dd.L[2]) < 0.12) throw new Error("A/D strafe legs should differ in Z, A=" + a.L[2] + " D=" + dd.L[2]);
  if (Math.abs(w.L[0] - s.L[0]) < 0.12 && Math.abs(w.R[0] - s.R[0]) < 0.12) {
    throw new Error("W/S legs should reverse, W Lx=" + w.L[0] + " S Lx=" + s.L[0]);
  }

  await page.evaluate(() => {
    window.__vela.setFpCrouch(true);
    window.__controlsTest.setKeys(["KeyW"]);
    window.__controlsTest.setLook(Math.PI, -0.9);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/workspace/screenshots/fp-body-crouch-walk.png" });
  await page.evaluate(() => {
    window.__controlsTest.setKeys([]);
    window.__vela.setFpCrouch(false);
    window.__vela.setFpProne(true);
    window.__controlsTest.setKeys(["KeyW"]);
    window.__controlsTest.setLook(Math.PI, -0.25);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/workspace/screenshots/fp-body-crawl.png" });
  await page.evaluate(() => window.__controlsTest.setKeys([]));

  if (pageErrors.length) throw new Error("page errors: " + pageErrors.join(" | "));
  console.log("LOCO_OK");
} finally {
  await browser.close();
}
