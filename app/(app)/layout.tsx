import { AppShell } from "@/components/app-shell";
import { StoreProvider } from "@/components/store/store-provider";
import { requireUser } from "@/lib/data/auth";
export default async function Layout({children}:{children:React.ReactNode}){await requireUser();return <StoreProvider><AppShell>{children}</AppShell></StoreProvider>}
