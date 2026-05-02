import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "InvoiceFlow, PDF invoices structured by Claude in seconds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#fafaf9",
          padding: "80px",
          fontFamily: "Helvetica, Arial, sans-serif",
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
              <rect width="40" height="40" rx="8" fill="#0f172a" />
              <rect
                x="11"
                y="7"
                width="18"
                height="26"
                rx="2.5"
                fill="none"
                stroke="#58a6ff"
                strokeWidth="2.2"
              />
              <line
                x1="14"
                y1="13"
                x2="26"
                y2="13"
                stroke="#79c0ff"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="14"
                y1="18"
                x2="26"
                y2="18"
                stroke="#79c0ff"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="14"
                y1="23"
                x2="22"
                y2="23"
                stroke="#79c0ff"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle cx="26" cy="27" r="3" fill="#388bfd" />
            </svg>
            <div
              style={{
                fontSize: 88,
                fontWeight: 800,
                color: "#18181b",
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
              color: "#3f3f46",
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
              color: "#71717a",
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
          <div style={{ fontSize: 22, color: "#71717a" }}>
            github.com/coreystevensdev/invoiceflow
          </div>
          <div style={{ fontSize: 22, color: "#71717a" }}>
            invoiceflow-cs.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
