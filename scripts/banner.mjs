// One-shot banner generator for the README. Mirrors the visual language of the
// sister project (tellsight/scripts/generate-screenshots.ts heroBannerHtml).
//
// Re-run when the banner copy or stack badges change:
//   node scripts/banner.mjs

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "screenshots");
const VIEWPORT = { width: 1280, height: 360 };

const PILLS = [
  "Next.js 16",
  "React 19",
  "TypeScript",
  "Claude API",
  "Zod",
  "Vitest",
];

function bannerHtml() {
  const pillStyle =
    "background:rgba(56,139,253,0.12); color:#58a6ff; padding:5px 14px; border-radius:20px; font-size:12px; font-weight:500; border:1px solid rgba(56,139,253,0.2);";
  const pills = PILLS.map(
    (p) => `<span style="${pillStyle}">${p}</span>`,
  ).join("\n      ");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
</style>
</head>
<body style="margin:0; padding:0;">
<div style="
  width:1280px; height:360px;
  background: linear-gradient(135deg, #0c1222 0%, #162036 35%, #1a1a3e 60%, #0f172a 100%);
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  position:relative; overflow:hidden; font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
">
  <div style="
    position:absolute; inset:0; opacity:0.04;
    background-image: linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px);
    background-size: 40px 40px;
  "></div>

  <div style="
    position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    width:600px; height:300px; border-radius:50%;
    background:radial-gradient(ellipse, rgba(56,139,253,0.12) 0%, transparent 70%);
  "></div>

  <div style="display:flex; align-items:center; gap:14px; margin-bottom:16px; position:relative;">
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="10" fill="rgba(56,139,253,0.15)"/>
      <rect x="11" y="7" width="18" height="26" rx="2.5" fill="none" stroke="#58a6ff" stroke-width="1.8"/>
      <line x1="14" y1="13" x2="26" y2="13" stroke="#79c0ff" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="14" y1="18" x2="26" y2="18" stroke="#79c0ff" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="14" y1="23" x2="22" y2="23" stroke="#79c0ff" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="26" cy="27" r="3" fill="#388bfd"/>
    </svg>
    <span style="font-size:36px; font-weight:800; color:#e6edf3; letter-spacing:-0.5px;">
      InvoiceFlow
    </span>
  </div>

  <p style="
    font-size:18px; color:#8b949e; font-weight:400; max-width:620px;
    text-align:center; line-height:1.5; position:relative;
  ">
    PDF invoices to structured data, in seconds. Zero retention by design.
  </p>

  <div style="
    display:flex; gap:8px; margin-top:28px; flex-wrap:wrap;
    justify-content:center; position:relative;
  ">
      ${pills}
  </div>
</div>
</body>
</html>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.setContent(bannerHtml(), { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "banner.png"), omitBackground: false });
    await ctx.close();
    console.log(`[banner] wrote ${join(OUT, "banner.png")}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[banner] failed:", err);
  process.exit(1);
});
