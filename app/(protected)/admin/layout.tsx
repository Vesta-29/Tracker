import { requireProfile } from "@/lib/route-auth";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireProfile(["admin"]);
  return children;
}
