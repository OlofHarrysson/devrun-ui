import { notFound } from "next/navigation";
import { DesignReference } from "../../components/design/DesignReference";
import "../../styles/olof-theme.css";
import "./reference.css";

export const metadata = {
  title: "Terminal Manager — design reference",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DesignReference />;
}
