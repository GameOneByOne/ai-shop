import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/data/auth";
export default async function Layout({children}:{children:React.ReactNode}){await requireUser();return <AppShell>{children}</AppShell>}
