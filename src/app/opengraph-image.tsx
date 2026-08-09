import { ImageResponse } from "next/og";
import { getSiteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const alt = "InvoiceFlow, PDF invoices structured by Claude in seconds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori (the OG image renderer) has no access to system or CSS fonts, so
// the display face has to be fetched as raw font bytes at request time.
// Google's css2 endpoint serves woff2 by default, which Satori can't parse;
// an old-browser user agent gets ttf instead, which it can.
async function loadSyneBold(): Promise<ArrayBuffer | null> {
  try {
    const cssRes = await fetch(
      "https://fonts.googleapis.com/css2?family=Syne:wght@700",
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36" } },
    );
    const css = await cssRes.text();
    const match = css.match(/src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function Image() {
  // OG images are cached and shared across surfaces, so they should show the
  // canonical production URL even when generated on a preview deployment.
  // Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deploy (production and
  // preview), and getSiteUrl() falls through to it after SITE_URL.
  const displayUrl = getSiteUrl().replace(/^https?:\/\//, "");
  const syneBold = await loadSyneBold();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#faf6ef",
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0px, transparent 27px, #ded5c2 27px, #ded5c2 28px)",
          padding: "80px",
          fontFamily: syneBold ? "Syne, Helvetica, Arial, sans-serif" : "Helvetica, Arial, sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            <svg width="80" height="80" viewBox="0 0 40 40">
              <rect width="40" height="40" rx="8" fill="#0c2d5c" />
              <rect
                x="11"
                y="7"
                width="18"
                height="26"
                rx="2.5"
                fill="none"
                stroke="#faf6ef"
                strokeWidth="2.2"
              />
              <line
                x1="14"
                y1="13"
                x2="26"
                y2="13"
                stroke="#7ea3d6"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="14"
                y1="18"
                x2="26"
                y2="18"
                stroke="#7ea3d6"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="14"
                y1="23"
                x2="22"
                y2="23"
                stroke="#7ea3d6"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle cx="26" cy="27" r="3" fill="#faf6ef" />
            </svg>
            <div
              style={{
                fontSize: 88,
                fontWeight: 700,
                color: "#1c1a16",
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
              }}
            >
              InvoiceFlow
            </div>
          </div>
          <div
            style={{
              fontSize: 36,
              color: "#4a453c",
              marginTop: 24,
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
            }}
          >
            PDF invoices, structured by Claude.
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#7a7568",
              marginTop: 8,
              lineHeight: 1.3,
            }}
          >
            About five seconds. No login. No retention.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ fontSize: 22, color: "#7a7568" }}>
            github.com/coreystevensdev/invoiceflow
          </div>
          <div style={{ fontSize: 22, color: "#7a7568" }}>
            {displayUrl}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: syneBold
        ? [{ name: "Syne", data: syneBold, weight: 700, style: "normal" }]
        : undefined,
    },
  );
}
