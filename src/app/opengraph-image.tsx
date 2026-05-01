import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "InvoiceFlow, PDF invoices to QuickBooks-ready CSV in seconds";
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
              fontSize: 88,
              fontWeight: 800,
              color: "#18181b",
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
            }}
          >
            Stop typing invoices into QuickBooks.
          </div>
          <div
            style={{
              fontSize: 32,
              color: "#52525b",
              marginTop: 32,
              lineHeight: 1.4,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Drop a PDF. Get vendor, line items, tax, total, due date.</span>
            <span>Under 5 seconds. No login. No database. No content logged.</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: "#18181b",
              letterSpacing: "-0.02em",
            }}
          >
            InvoiceFlow
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
