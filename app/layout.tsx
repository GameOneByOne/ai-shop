import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"AI 店长",description:"个人淘宝卖家的轻量经营中台"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
