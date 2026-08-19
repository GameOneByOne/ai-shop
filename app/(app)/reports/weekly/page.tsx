import{ReportStudio}from"@/components/reports/report-studio";
export default function Page(){return <><header className="top"><div><div className="eyebrow">Reports</div><h1>AI 店长周报</h1><p className="muted">基于当前账户数据总结本周表现、实验反馈与下周重点</p></div></header><ReportStudio type="weekly"/></>}
