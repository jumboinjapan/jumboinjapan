import Link from "next/link";

interface LogoProps {
  size?: "sm" | "lg";
  className?: string;
}

export function Logo({ size = "sm", className = "" }: LogoProps) {
  const wordSize = size === "lg" ? "72px" : "36px";
  const inSize = size === "lg" ? "15px" : "10px";
  const lineWidth = size === "lg" ? "110px" : "44px";
  const rowGap = size === "lg" ? "22px" : "12px";
  const rowMargin = size === "lg" ? "14px" : "7px";

  return (
    <Link
      href="/"
      className={`flex flex-col items-center text-center no-underline ${className}`}
      style={{ fontFamily: "var(--font-cormorant), 'Cormorant Garamond', serif", fontWeight: 300 }}
    >
      <span style={{ fontSize: wordSize, letterSpacing: "0.38em", marginRight: "-0.38em", lineHeight: 1, textTransform: "uppercase", color: "var(--text)" }}>
        Jumbo
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: rowGap, marginTop: rowMargin, marginBottom: rowMargin }}>
        <div style={{ height: "0.5px", width: lineWidth, background: "var(--text)", opacity: 0.22 }} />
        <span style={{ fontSize: inSize, letterSpacing: "0.15em", color: "var(--text)", opacity: 0.38, fontStyle: "italic", textTransform: "lowercase" }}>
          in
        </span>
        <div style={{ height: "0.5px", width: lineWidth, background: "var(--text)", opacity: 0.22 }} />
      </div>
      <span style={{ fontSize: wordSize, letterSpacing: "0.38em", marginRight: "-0.38em", lineHeight: 1, textTransform: "uppercase", color: "var(--text)" }}>
        Japan
      </span>
    </Link>
  );
}
