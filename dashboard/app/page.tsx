import { redirect } from "next/navigation";

// During design phase, redirect to the design lab
export default function HomePage() {
  redirect("/__design_lab");
}
