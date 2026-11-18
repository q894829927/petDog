import { useEffect, type CSSProperties } from "react";
import { Icon } from "./Icons";
import { useGameUI, type StatKey, type ToolMode } from "../store/useGameUI";

const previewStats: { key: StatKey; label: string; icon: "bowl" | "drop" | "bolt" | "sparkle"; value: number }[] = [
  { key: "hunger", label: "饱腹", icon: "bowl", value: 76 },
  { key: "water", label: "水分", icon: "drop", value: 84 },
  { key: "energy", label: "精力", icon: "bolt", value: 62 },
  { key: "clean", label: "清洁", icon: "sparkle", value: 93 },
];

function StatRings() {
  const active = useGameUI((state) => state.statDetail);
  const setActive = useGameUI((state) => state.setStatDetail);
  return (
    <div className="stat-cluster glass" aria-label="宠物状态示例">
      <span className="stats-prefix">状态</span>
      {previewStats.map(({ key, label, icon, value }) => (
        <div key={key} className="stat-item">
          <button
            type="button"
            className={"stat-ring" + (active === key ? " stat-ring--active" : "")}
            style={{ "--stat-value": String(value) + "%" } as CSSProperties}
            onClick={() => setActive(active === key ? null : key)}
            title={label + " " + value + "/100（示例）"}
            aria-label={label + " " + value + "/100，示例状态"}
            aria-expanded={active === key}
          >
            <span className="stat-ring-core"><Icon name={icon} size={19}/></span>
          </button>
          {active === key && (
            <div className="stat-popover" role="status">
              <strong>{label}</strong>
              <span>{value}/100</span>
              <small>演示数据</small>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const toolHint: Record<ToolMode, string> = {
  pet: "直接触摸柴犬，轻轻摸摸它",
  ball: "点击柴犬或地面，试着把球抛出去",
  brush: "轻触柴犬，给它梳梳毛",
};

function InteractionDock() {
  const tool = useGameUI((state) => state.tool);
  const setTool = useGameUI((state) => state.setTool);
  const foodOpen = useGameUI((state) => state.foodOpen);
  const toggleFood = useGameUI((state) => state.toggleFood);
  const trigger = useGameUI((state) => state.trigger);
  return (
    <div className="dock-wrap">
      {foodOpen && (
        <div className="food-tray glass" role="group" aria-label="饮食选择">
          <button type="button" onClick={() => trigger("feed")}><Icon name="bowl" size={22}/> <span>加狗粮</span></button>
          <button type="button" onClick={() => trigger("water")}><Icon name="drop" size={22}/> <span>倒清水</span></button>
        </div>
      )}
      <nav className="action-dock glass" aria-label="互动工具">
        <button type="button" className={"dock-item" + (tool === "pet" && !foodOpen ? " dock-item--active" : "")} onClick={() => setTool("pet")} aria-pressed={tool === "pet" && !foodOpen}>
          <span className="dock-icon"><Icon name="hand" size={24}/></span><span>抚摸</span>
        </button>
        <button type="button" className="dock-item" onClick={() => trigger("call")}>
          <span className="dock-icon"><Icon name="whistle" size={24}/></span><span>呼唤</span>
        </button>
        <button type="button" className={"dock-item" + (foodOpen ? " dock-item--active" : "")} onClick={toggleFood} aria-expanded={foodOpen}>
          <span className="dock-icon"><Icon name="bowl" size={24}/></span><span>饮食</span>
        </button>
        <button type="button" className={"dock-item" + (tool === "ball" ? " dock-item--active" : "")} onClick={() => setTool(tool === "ball" ? "pet" : "ball")} aria-pressed={tool === "ball"}>
          <span className="dock-icon"><Icon name="ball" size={24}/></span><span>玩球</span>
        </button>
        <button type="button" className={"dock-item" + (tool === "brush" ? " dock-item--active" : "")} onClick={() => setTool(tool === "brush" ? "pet" : "brush")} aria-pressed={tool === "brush"}>
          <span className="dock-icon"><Icon name="comb" size={24}/></span><span>梳毛</span>
        </button>
      </nav>
    </div>
  );
}

function DetailsPanel() {
  const panel = useGameUI((state) => state.panel);
  const setPanel = useGameUI((state) => state.setPanel);
  const quality = useGameUI((state) => state.quality);
  const setQuality = useGameUI((state) => state.setQuality);
  if (!panel) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
      <section className="detail-modal glass" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <div className="modal-heading">
          <div><span className="tiny-label">倩岚汪 · 界面原型</span><h2 id="panel-title">{panel === "profile" ? "团子的档案" : "游戏设置"}</h2></div>
          <button type="button" className="icon-button" aria-label="关闭面板" onClick={() => setPanel(null)}><Icon name="close" size={19}/></button>
        </div>
        {panel === "profile" ? (
          <div className="profile-content">
            <div className="profile-portrait"><Icon name="paw" size={37}/></div>
            <p className="profile-name">团子 <span>柴犬</span></p>
            <div className="profile-grid">
              <div><small>年龄</small><strong>12 天</strong></div>
              <div><small>性格</small><strong>活泼</strong></div>
              <div><small>亲密度</small><strong>♥ Lv.3</strong></div>
              <div><small>状态</small><strong>正在探索</strong></div>
            </div>
            <p className="modal-note">当前为界面示例档案。正式的领养、改名与成长数据将在账号系统完成后接入。</p>
          </div>
        ) : (
          <div className="settings-content">
            <p className="setting-label">场景画质</p>
            <div className="segmented" role="group" aria-label="场景画质">
              <button type="button" className={quality === "high" ? "selected" : ""} onClick={() => setQuality("high")}>标准</button>
              <button type="button" className={quality === "low" ? "selected" : ""} onClick={() => setQuality("low")}>省电</button>
            </div>
            <p className="modal-note">画质切换会调整渲染精度与阴影。音效、账号登录、云端存档和退出登录将在后续版本开放。</p>
            <a href="/" className="settings-back"><Icon name="back" size={17}/> 返回游戏大厅</a>
          </div>
        )}
      </section>
    </div>
  );
}

export function GameHUD() {
  const panel = useGameUI((state) => state.panel);
  const setPanel = useGameUI((state) => state.setPanel);
  const notice = useGameUI((state) => state.notice);
  const clearNotice = useGameUI((state) => state.clearNotice);
  const tool = useGameUI((state) => state.tool);
  const foodOpen = useGameUI((state) => state.foodOpen);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 3000);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPanel(null); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [setPanel]);

  return (
    <div className="hud-layer">
      <header className="hud-top">
        <button type="button" className="pet-profile-pill glass" onClick={() => setPanel(panel === "profile" ? null : "profile")} aria-label="查看团子的档案">
          <span className="profile-avatar"><Icon name="paw" size={21}/></span>
          <span className="profile-titles"><strong>团子 <Icon name="chevron" size={13}/></strong><small>柴犬 · ♥ Lv.3</small></span>
        </button>
        <StatRings />
        <div className="hud-system">
          <div className="sync-pill glass" title="当前为 UI 演示，尚未连接云端">
            <span className="sync-dot"/><Icon name="cloud" size={17}/><span>未接入云端</span>
          </div>
          <button type="button" className="icon-button glass" onClick={() => setPanel("settings")} aria-label="游戏设置"><Icon name="settings" size={22}/></button>
        </div>
      </header>
      <div className="demo-marker glass"><span className="demo-marker-dot"/>3D 界面原型 · 数据为示例</div>
      <div className="scene-tag"><Icon name="sparkle" size={15}/><span>团子的小窝</span></div>
      {notice && <div className="scene-notice glass" role="status" aria-live="polite"><Icon name="heart" size={17}/><span>{notice}</span></div>}
      <div className="hud-bottom">
        <div className="action-hint"><Icon name="paw" size={17}/><span>{foodOpen ? "选择食物或饮水" : toolHint[tool]}</span></div>
        <InteractionDock />
      </div>
      <DetailsPanel />
    </div>
  );
}
