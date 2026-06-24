import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">PHASE 1 · SELF NOTES</p>
        <h1>笔记系统</h1>
        <p>
          保留原始表达、错因、题号和 TODO。当前只启用物理模块，不包含公开讲义。
        </p>
      </section>
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">SUBJECTS</p>
            <h2>学科入口</h2>
          </div>
        </div>
        <div className="subject-grid">
          <Link className="subject-card active" href="/physics">
            <span>01</span>
            <h3>物理</h3>
            <p>模型总结、错题卡、原始笔记与待整理清单</p>
          </Link>
          {["数学", "化学", "英语", "语文", "其他笔记"].map((subject) => (
            <div className="subject-card disabled" key={subject}>
              <span>未来扩展</span>
              <h3>{subject}</h3>
              <p>第一阶段暂不启用</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
