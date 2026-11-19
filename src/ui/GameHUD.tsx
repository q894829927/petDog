import { useEffect, type CSSProperties } from "react";
import { Icon } from "./Icons";
import { CloudPanel, personalityLabel } from "./CloudPanel";
import { useCloudPet } from "../cloud/useCloudPet";
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
  const pet = useCloudPet((state) => state.pet);
  const stats = pet && { hunger: pet.hunger, water: pet.hydration, energy: pet.energy, clean: pet.cleanliness };
  return (
    <div className="stat-cluster glass" aria-label={pet ? "宠物状态" : "宠物状态示例"}>
      <span className="stats-prefix">状态</span>
      {previewStats.map(({ key, label, icon, value: preview }) => {
        const value = stats ? Math.round(stats[key]) : preview;
        const detail = label + " " + value + "/100" + (pet ? "" : "（示例）");
        return (
        <div key={key} className="stat-item">
          <button
            type="button"
            className={"stat-ring" + (active === key ? " stat-ring--active" : "")}
            style={{ "--stat-value": String(value) + "%" } as CSSProperties}
            onClick={() => setActive(active === key ? null : key)}
            title={detail}
            aria-label={detail}
            aria-expanded={active === key}
          >
            <span className="stat-ring-core"><Icon name={icon} size={19}/></span>
          </button>
          {active === key && (
            <div className="stat-popover" role="status">
              <strong>{label}</strong>
              <span>{value}/100</span>
              {!pet && <small>演示数据</small>}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

const toolHint: Record<ToolMode, string> = {
  pet: "轻触团子，摸摸它",
  ball: "点击团子或地面，把球抛出去",
  brush: "从团子的肩背朝尾巴梳",
  poke: "等团子转身，轻点尾巴下方的圆点",
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
        <button type="button" className={"dock-item" + (tool === "poke" ? " dock-item--active" : "")} aria-pressed={tool === "poke"} onClick={() => {
          setTool(tool === "poke" ? "pet" : "poke");
          if (tool !== "poke") trigger("aimPoke");
        }}>
          <span className="dock-icon"><Icon name="target" size={24}/></span><span>点戳</span>
        </button>
        <button type="button" className="dock-item" onClick={() => {
          if (tool === "poke") setTool("pet");
          trigger("call");
        }}>
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
  const pet = useCloudPet((state) => state.pet);
  const name = pet?.name ?? "团子";
  if (!panel) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
      <section className="detail-modal glass" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <div className="modal-heading">
          <h2 id="panel-title">{panel === "profile" ? name + "的档案" : panel === "account" ? "账号与云存档" : "游戏设置"}</h2>
          <button type="button" className="icon-button" aria-label="关闭面板" onClick={() => setPanel(null)}><Icon name="close" size={19}/></button>
        </div>
        {panel === "account" ? <CloudPanel close={() => setPanel(null)} /> : panel === "profile" ? (
          <div className="profile-content">
            <div className="profile-portrait"><Icon name="paw" size={37}/></div>
            <p className="profile-name">{name} <span>秋田犬</span></p>
            <div className="profile-grid">
              <div><small>领养时长</small><strong>{pet ? Math.floor((pet.serverTime - pet.adoptedAt) / 86_400_000) + " 天" : "12 天"}</strong></div>
              <div><small>性格</small><strong>{pet ? personalityLabel[pet.personality] : "活泼"}</strong></div>
              <div><small>亲密度</small><strong>{pet ? Math.round(pet.affection) + "/100" : "♥ Lv.3"}</strong></div>
              <div><small>状态</small><strong>{pet?.sleeping ? "在休息" : "清醒"}</strong></div>
            </div>
            {!pet && <p className="modal-note">这是试玩档案。登录后可以领养并保存进度。</p>}
          </div>
        ) : (
          <div className="settings-content">
            <p className="setting-label">场景画质</p>
            <div className="segmented" role="group" aria-label="场景画质">
              <button type="button" className={quality === "high" ? "selected" : ""} aria-pressed={quality === "high"} onClick={() => setQuality("high")}>标准</button>
              <button type="button" className={quality === "low" ? "selected" : ""} aria-pressed={quality === "low"} onClick={() => setQuality("low")}>省电</button>
            </div>
            <p className="modal-note">标准使用高模和阴影。省电使用低模、降低渲染精度并关闭阴影。</p>
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
  const { pet, connected, email, busy, error } = useCloudPet();
  const name = pet?.name ?? "团子";
  const cloudStatus = connected === null ? "正在连接" : !connected ? "云端未连接" :
    !email ? "登录" : error ? "同步待重试" : busy ? "同步中" : pet ? "已同步" : "待领养";

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
        <button type="button" className="pet-profile-pill glass" onClick={() => setPanel(panel === "profile" ? null : "profile")} aria-label={"查看" + name + "的档案"}>
          <span className="profile-avatar"><Icon name="paw" size={21}/></span>
          <span className="profile-titles"><strong><span>{name}</span><Icon name="chevron" size={13}/></strong><small>秋田犬 · ♥ {pet ? Math.round(pet.affection) : "Lv.3"}</small></span>
        </button>
        <StatRings />
        <div className="hud-system">
          <button type="button" className="sync-pill glass" aria-label={"账号与云存档，" + cloudStatus} onClick={() => setPanel("account")}>
            <span className={"sync-dot" + (cloudStatus === "已同步" ? " sync-dot--ok" : "")}/><Icon name="cloud" size={17}/><span>{cloudStatus}</span>
          </button>
          <button type="button" className="icon-button glass" onClick={() => setPanel("settings")} aria-label="游戏设置"><Icon name="settings" size={22}/></button>
        </div>
      </header>
      {!pet && <div className="demo-marker glass"><span className="demo-marker-dot"/>试玩 · 数据为示例</div>}
      <div className="scene-tag"><Icon name="sparkle" size={15}/><span>{name}的小窝</span></div>
      {notice && <div className="scene-notice glass" role="status" aria-live="polite"><Icon name="heart" size={17}/><span>{notice.replaceAll("团子", () => name)}</span></div>}
      <div className="hud-bottom">
        <div className="action-hint"><Icon name="paw" size={17}/><span>{foodOpen ? "选择食物或饮水" : toolHint[tool].replaceAll("团子", () => name)}</span></div>
        <InteractionDock />
      </div>
      <DetailsPanel />
    </div>
  );
}
