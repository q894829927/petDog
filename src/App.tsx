const buildSha = import.meta.env.VITE_BUILD_SHA ?? "local";

function ShibaIllustration() {
  return (
    <svg className="shiba" viewBox="0 0 420 430" role="img" aria-label="柴犬插画">
      <ellipse cx="210" cy="393" rx="126" ry="19" fill="#d8c6a9" opacity=".55" />
      <path d="M105 251c-8-45 10-94 43-120 31-25 94-29 130-5 35 23 51 70 40 122l-10 80c-4 29-28 48-57 48h-81c-31 0-55-22-58-51z" fill="#c66c35" />
      <path d="M139 280c17-19 40-28 71-28s55 9 72 28l8 60c3 24-15 42-40 42h-79c-25 0-43-18-40-42z" fill="#f8e8ce" />
      <path d="M112 139 92 35c-3-15 14-24 25-13l76 73z" fill="#b95d2e" />
      <path d="m308 139 20-104c3-15-14-24-25-13l-76 73z" fill="#b95d2e" />
      <path d="m112 119-9-66c-2-11 9-16 17-8l49 49z" fill="#f3b9a0" />
      <path d="m308 119 9-66c2-11-9-16-17-8l-49 49z" fill="#f3b9a0" />
      <path d="M113 167c0-66 43-112 97-112s97 46 97 112c0 61-39 108-97 108s-97-47-97-108z" fill="#d67b3e" />
      <path d="M145 174c7-26 25-39 48-38 15 1 26 10 30 26-5 31-23 51-49 51-21 0-34-16-29-39z" fill="#f7e7ce" />
      <path d="M275 174c-7-26-25-39-48-38-15 1-26 10-30 26 5 31 23 51 49 51 21 0 34-16 29-39z" fill="#f7e7ce" />
      <ellipse cx="169" cy="163" rx="7" ry="10" fill="#33251f" />
      <ellipse cx="251" cy="163" rx="7" ry="10" fill="#33251f" />
      <path d="M195 194c0-8 7-13 15-13s15 5 15 13c0 7-8 12-15 12s-15-5-15-12z" fill="#33251f" />
      <path d="M210 205c-2 14-12 20-25 18m25-18c2 14 12 20 25 18" fill="none" stroke="#654237" strokeWidth="5" strokeLinecap="round" />
      <path d="M117 286c-25 6-39 22-40 45-1 19 10 33 27 34 16 1 28-13 31-33l6-39z" fill="#c66c35" />
      <path d="M303 286c25 6 39 22 40 45 1 19-10 33-27 34-16 1-28-13-31-33l-6-39z" fill="#c66c35" />
      <path d="M126 354c-15 4-24 17-21 30 3 11 14 16 32 16h42c9 0 13-8 9-16l-14-29z" fill="#f8e8ce" />
      <path d="M294 354c15 4 24 17 21 30-3 11-14 16-32 16h-42c-9 0-13-8-9-16l14-29z" fill="#f8e8ce" />
      <path d="M146 278c18 18 37 25 64 25s46-7 64-25" fill="none" stroke="#f2c78f" strokeWidth="9" strokeLinecap="round" />
      <path d="M148 278c19 17 38 23 62 23s43-6 62-23" fill="none" stroke="#54776d" strokeWidth="10" strokeLinecap="round" />
      <circle cx="210" cy="301" r="9" fill="#e5bd6e" stroke="#9b713c" strokeWidth="3" />
      <path d="M318 302c25-3 38-19 33-39-4-16-22-20-31-5-7 12-1 24 12 25" fill="none" stroke="#c66c35" strokeWidth="19" strokeLinecap="round" />
      <path d="M318 302c25-3 38-19 33-39-4-16-22-20-31-5-7 12-1 24 12 25" fill="none" stroke="#f0c58f" strokeWidth="7" strokeLinecap="round" />
      <circle cx="86" cy="315" r="18" fill="#e8b85d" />
      <path d="M70 315h32M86 299v32" stroke="#fff2d7" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const shortSha = buildSha === "local" ? "LOCAL PREVIEW" : buildSha.slice(0, 7).toUpperCase();

  return (
    <main className="page">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="返回游戏大厅">
          <span className="wordmark-icon">犬</span>
          <span>QIAN LAN WAN</span>
        </a>
        <span className="topbar-note">A LITTLE PET, A LOT OF LOVE</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">YOUR LITTLE COMPANION</p>
          <h1>倩岚汪<span>。</span></h1>
          <p className="lead">一只柴犬，和你一起生活。</p>
          <p className="description">
            抚摸它、呼唤它，陪它玩耍，也看看它在自己的小世界里做些什么。
            这里正在为第一只柴犬准备一个温暖的家。
          </p>
          <div className="status-row">
            <span className="status-dot" />
            <span>柴犬正在准备入住</span>
          </div>
          <a className="back-link" href="/">返回游戏大厅 <span aria-hidden="true">↗</span></a>
        </div>

        <div className="pet-stage">
          <div className="sun-disc" />
          <div className="stage-label stage-label--top">NO. 001 · SHIBA INU</div>
          <div className="stage-floor" />
          <ShibaIllustration />
          <div className="pet-caption">
            <span className="caption-heart">♡</span>
            <span>第一位小伙伴</span>
          </div>
        </div>
      </section>

      <section className="coming-panel">
        <div>
          <p className="panel-kicker">THE LITTLE WORLD IS GROWING</p>
          <h2>一个可以长期陪伴的宠物世界</h2>
          <p>3D 宠物互动、云端存档与跨设备陪伴正在开发中。</p>
        </div>
        <div className="feature-list">
          <span>抚摸与回应</span>
          <span>喂食和玩耍</span>
          <span>自主生活</span>
        </div>
      </section>

      <footer className="footer">
        <span>倩岚汪 · EARLY PREVIEW</span>
        <span>BUILD {shortSha}</span>
      </footer>
    </main>
  );
}
