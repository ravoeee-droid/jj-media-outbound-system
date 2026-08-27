import Link from "next/link";
import OutboundDashboard from "../components/OutboundDashboard";

const floatingLinkStyle = {
  position: "fixed" as const,
  right: 22,
  zIndex: 300,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  borderRadius: 999,
  color: "#fff",
  padding: "12px 17px",
  boxShadow: "0 14px 36px rgba(15,23,42,.25)",
  fontSize: 12,
  fontWeight: 800,
  textDecoration: "none",
};

export default function DashboardPage() {
  return (
    <>
      <OutboundDashboard userName="JJ-Media" />
      <Link
        href="/system"
        style={{
          ...floatingLinkStyle,
          bottom: 22,
          background: "#101827",
        }}
      >
        ◉ System-Logs
      </Link>
    </>
  );
}
