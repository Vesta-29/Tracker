import { requireProfile } from "@/lib/route-auth";
import ProtectedShell from "@/components/protected-shell";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const profile = await requireProfile();
  return <ProtectedShell initialProfile={profile}>{children}</ProtectedShell>;
}
