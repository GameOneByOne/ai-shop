import{ReportStudio}from"@/components/reports/report-studio";
export default function Page(){return <><header className="top"><div><div className="eyebrow">Reports</div><h1>AI 店长日报</h1><p className="muted">基于当前账户经营数据，总结昨天并安排今天</p></div></header><ReportStudio type="daily"/></>}
