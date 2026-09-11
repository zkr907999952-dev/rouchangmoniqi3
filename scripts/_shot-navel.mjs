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
  await page.waitForFunction(() => window.__vela && typeof window.__vela.setPose === "function", {
    timeout: 25000,
  });
  await page.waitForTimeout(700);
  await page.evaluate(
    ({ pose, insert, view }) => {
      window.__vela.setPose(pose);
      if (insert > 0) window.__vela.setNavelInsert(insert);
      if (view === "wide" && window.__vela.frameArm) window.__vela.frameArm();
      else if (view === "navel" && window.__vela.frameNavel) window.__vela.frameNavel();
      else if (window.__vela.frameBelly) window.__vela.frameBelly();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    },
    { pose, insert, view },
  );
  await page.waitForTimeout(2400);
  const dump = await page.evaluate(() => (window.__vela.dumpArm ? window.__vela.dumpArm() : null));
  console.log("dump", JSON.stringify(dump, null, 2));
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
