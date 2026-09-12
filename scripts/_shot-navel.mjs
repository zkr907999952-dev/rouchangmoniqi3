import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const pose = process.argv[2] || "navelPoke";
const insert = Number(process.argv[3] || "0");
const out = process.argv[4] || "/workspace/screenshots/pose-navel-poke.png";
const view = process.argv[5] || "navel";

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
    () => window.__vela && typeof window.__vela.setPose === "function" && typeof window.__vela.frameBelly === "function",
    { timeout: 25000 },
  );
  await page.waitForTimeout(900);
  await page.evaluate(
    ({ pose, insert }) => {
      window.__vela.setPose(pose);
      if (typeof insert === "number") window.__vela.setNavelInsert(insert);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    },
    { pose, insert },
  );
  await page.waitForTimeout(1800);
  const cam = await page.evaluate((view) => {
    if (view === "wide" && window.__vela.frameArm) return window.__vela.frameArm();
    if (view === "close" && window.__vela.frameNavel) return window.__vela.frameNavel();
    if (window.__vela.frameBelly) return window.__vela.frameBelly();
    return null;
  }, view);
  console.log("cam", cam);
  await page.waitForTimeout(700);
  const dump = await page.evaluate(() => (window.__vela.dumpArm ? window.__vela.dumpArm() : null));
  console.log(
    "dump",
    JSON.stringify(
      {
        pose: dump?.pose,
        navelInsert: dump?.navelInsert,
        navelDepth: dump?.navelDepth,
        navelDiameter: dump?.navelDiameter,
        navelDepthRatio: dump?.navelDepthRatio,
        navel: dump?.navel,
        Index_c: dump?.bones?.R_Index_c,
        Hand: dump?.bones?.R_Hand_a,
        fingerDir: dump?.fingerDir,
      },
      null,
      2,
    ),
  );
  const data = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? c.toDataURL("image/png") : "";
  });
  if (!data.includes(",")) throw new Error("no canvas data");
  writeFileSync(out, Buffer.from(data.split(",")[1], "base64"));
  console.log("wrote", out, data.length);
} finally {
  await browser.close();
}
