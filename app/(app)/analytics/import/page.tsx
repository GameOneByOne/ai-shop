import { CsvImporter } from "@/components/analytics/csv-importer";
export default function Page() { return <><header className="top"><div><div className="eyebrow">Phase 3</div><h1>导入经营数据</h1><p className="muted">上传、预览、校验并人工确认后写入</p></div></header><div className="notice">导入使用 <strong>SKU 编码 + 日期</strong> 更新或创建数据。确认前不会修改数据库。</div><CsvImporter/></>; }
