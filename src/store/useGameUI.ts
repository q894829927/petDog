import { create } from "zustand";

export type ToolMode = "pet" | "ball" | "brush";
export type InteractionKind = "pet" | "call" | "feed" | "water" | "ball" | "brush";
export type ActivePanel = "profile" | "settings" | null;
export type StatKey = "hunger" | "water" | "energy" | "clean";

type Interaction = { kind: InteractionKind; sequence: number };

type GameUI = {
  tool: ToolMode;
  foodOpen: boolean;
  panel: ActivePanel;
  statDetail: StatKey | null;
  notice: string | null;
  interaction: Interaction | null;
  quality: "high" | "low";
  setTool: (tool: ToolMode) => void;
  toggleFood: () => void;
  setPanel: (panel: ActivePanel) => void;
  setStatDetail: (key: StatKey | null) => void;
  setQuality: (quality: "high" | "low") => void;
  trigger: (kind: InteractionKind) => void;
  setNotice: (notice: string) => void;
  clearNotice: () => void;
};

const messages: Record<Exclude<InteractionKind, "ball">, string> = {
  pet: "团子低下头，凑近了你的手。",
  call: "团子听到了你的呼唤！",
  feed: "团子低下头，小口吃了起来。",
  water: "团子低下头，舔了几口水。",
  brush: "团子很享受被轻轻梳毛。",
};

export const useGameUI = create<GameUI>((set) => ({
  tool: "pet",
  foodOpen: false,
  panel: null,
  statDetail: null,
  notice: null,
  interaction: null,
  quality: "high",
  setTool: (tool) => set({ tool, foodOpen: false, statDetail: null }),
  toggleFood: () => set((state) => ({ foodOpen: !state.foodOpen, tool: "pet", statDetail: null })),
  setPanel: (panel) => set({ panel, foodOpen: false, statDetail: null }),
  setStatDetail: (statDetail) => set({ statDetail, foodOpen: false }),
  setQuality: (quality) => set({ quality }),
  trigger: (kind) => set((state) => ({
    interaction: { kind, sequence: (state.interaction?.sequence ?? 0) + 1 },
    notice: kind === "ball" ? state.notice : messages[kind],
    foodOpen: false,
  })),
  setNotice: (notice) => set({ notice }),
  clearNotice: () => set({ notice: null }),
}));
