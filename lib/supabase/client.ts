import { createBrowserClient } from "@supabase/ssr";
export function createClient(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)throw new Error("缺少 Supabase 浏览器环境变量");return createBrowserClient(url,key)}
