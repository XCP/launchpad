import { ImageResponse } from "next/og";

export const alt = "69 addresses, an unknown number of people";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function ResearchOpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: "64px 72px",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(135deg, rgb(250 250 252) 0%, rgb(245 243 255) 58%, rgb(236 253 245) 100%)",
          color: "rgb(17 24 39)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: 28, fontWeight: 700 }}>
          <span style={{ color: "rgb(126 34 206)" }}>XCP.FUN</span>
          <span style={{ color: "rgb(156 163 175)", fontWeight: 400 }}>RESEARCH</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: "980px" }}>
          <div style={{ fontSize: 66, lineHeight: 1.05, fontWeight: 700, letterSpacing: "-2px" }}>
            69 addresses, an unknown number of people
          </div>
          <div style={{ marginTop: 24, fontSize: 28, lineHeight: 1.35, color: "rgb(75 85 99)" }}>
            Address caps, exit order, and what the first XCP-69 launches actually show
          </div>
        </div>

        <div style={{ display: "flex", gap: "18px" }}>
          {[
            ["15.2M", "first-exit optimum"],
            ["37.8M", "coordinated break-even"],
            ["6.88 XCP", "average if all 69 sell"],
          ].map(([value, label]) => (
            <div
              key={value}
              style={{
                display: "flex",
                minWidth: "250px",
                padding: "18px 22px",
                flexDirection: "column",
                border: "1px solid rgb(221 214 254)",
                borderRadius: 18,
                background: "rgba(255,255,255,0.78)",
              }}
            >
              <span style={{ fontSize: 30, fontWeight: 700 }}>{value}</span>
              <span style={{ marginTop: 4, fontSize: 18, color: "rgb(107 114 128)" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
