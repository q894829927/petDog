import { create } from "zustand";

export type ToolMode = "pet" | "ball" | "brush";
export type InteractionKind = "pet" | "call" | "feed" | "water" | "ball" | "brush";
export type MealKind = "feed" | "water";
export type PetPart = "head" | "chin" | "back";
export type ActivePanel = "profile" | "settings" | "account" | null;
export type StatKey = "hunger" | "water" | "energy" | "clean";

export type Interaction = { kind: InteractionKind; part: PetPart; sequence: number };

type GameUI = {
  tool: ToolMode;
  foodOpen: boolean;
  panel: ActivePanel;
  statDetail: StatKey | null;
  notice: string | null;
  interaction: Interaction | null;
  bowl: { kind: MealKind; portions: number } | null;
  quality: "high" | "low";
  setTool: (tool: ToolMode) => void;
  toggleFood: () => void;
  setPanel: (panel: ActivePanel) => void;
  setStatDetail: (key: StatKey | null) => void;
  setQuality: (quality: "high" | "low") => void;
  trigger: (kind: InteractionKind, part?: PetPart) => void;
  setBowl: (kind: MealKind, portions: number) => void;
  setNotice: (notice: string) => void;
  clearNotice: () => void;
};

export const petMessages: Record<PetPart, string> = {
  head: "团子低下头，凑近了你的手。",
  chin: "团子抬起下巴，让你再挠一会儿。",
  back: "团子回头看了看摸它的手。",
};

export const useGameUI = create<GameUI>((set) => ({
  tool: "pet",
  foodOpen: false,
  panel: null,
  statDetail: null,
  notice: null,
  interaction: null,
  bowl: null,
  quality: "high",
  setTool: (tool) => set({ tool, foodOpen: false, statDetail: null }),
  toggleFood: () => set((state) => ({ foodOpen: !state.foodOpen, tool: "pet", statDetail: null })),
  setPanel: (panel) => set({ panel, foodOpen: false, statDetail: null }),
  setStatDetail: (statDetail) => set({ statDetail, foodOpen: false }),
  setQuality: (quality) => set({ quality }),
  trigger: (kind, part = "head") => set((state) => ({
    interaction: { kind, part, sequence: (state.interaction?.sequence ?? 0) + 1 },
    notice: kind === "pet" ? petMessages[part] : kind === "brush" ? "团子摇摇尾巴，背上的毛梳顺了。" : state.notice,
    foodOpen: false,
  })),
  setBowl: (kind, portions) => set({ bowl: portions ? { kind, portions } : null }),
  setNotice: (notice) => set({ notice }),
  clearNotice: () => set({ notice: null }),
}));
