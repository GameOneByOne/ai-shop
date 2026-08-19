import Link from "next/link";
import { logout } from "@/app/(auth)/login/logout-action";
const links=[["/dashboard","Dashboard"],["/products/discover","货源发现"],["/products/candidates","选品池"],["/content","内容制作"],["/suppliers","供应商"],["/skus","SKU"],["/analytics/daily","经营数据"],["/ai-manager","AI 店长"],["/tasks","任务"],["/experiments","实验"],["/reports/daily","报告"],["/settings","设置"]];
export function AppShell({children}:{children:React.ReactNode}){return <div className="shell"><aside className="side"><div className="brand">AI 店长</div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</nav><form action={logout}><button className="logout-btn">退出登录</button></form></aside><main className="main">{children}</main></div>}

