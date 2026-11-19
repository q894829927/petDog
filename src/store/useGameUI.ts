import { create } from "zustand";

export type ToolMode = "pet" | "ball" | "brush";
export type InteractionKind = "pet" | "call" | "feed" | "water" | "ball" | "brush";
export type MealKind = "feed" | "water";
export type PetPart = "head" | "ear" | "cheek" | "chin" | "chest" | "back" | "flank" | "leg" | "paw" | "tailRoot" | "tail" | "belly" | "rear";
export type PetSide = "L" | "R";
export type PetTarget = { part: PetPart; side?: PetSide; hind?: boolean };
export type ActivePanel = "profile" | "settings" | "account" | null;
export type StatKey = "hunger" | "water" | "energy" | "clean";

export type Interaction = PetTarget & { kind: InteractionKind; sequence: number };

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
  trigger: (kind: InteractionKind, target?: PetTarget) => void;
  setBowl: (kind: MealKind, portions: number) => void;
  setNotice: (notice: string) => void;
  clearNotice: () => void;
};

export const petMessages: Record<PetPart, string> = {
  head: "团子低下头，凑近了你的手。",
  ear: "团子抖了抖耳朵，朝你歪了下头。",
  cheek: "团子凑过来，嗅了嗅你的手指。",
  chin: "团子抬起下巴，让你再挠一会儿。",
  chest: "团子伸了伸脖子，放松了肩膀。",
  back: "团子回头看了看摸它的手。",
  flank: "团子把身子轻轻靠向你的手。",
  leg: "团子低头看了看你摸到的腿。",
  paw: "团子轻轻收了一下爪子。",
  tailRoot: "团子摇了两下尾巴。",
  tail: "团子把尾尖轻轻摆开。",
  belly: "团子松开了前爪，舒服地呼了口气。",
  rear: "团子收了收尾巴，回头瞧了你一眼。",
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
  trigger: (kind, target = { part: "head" }) => set((state) => ({
    interaction: { ...target, kind, sequence: (state.interaction?.sequence ?? 0) + 1 },
    notice: kind === "pet" ? petMessages[target.part] : kind === "brush" ? "团子摇摇尾巴，背上的毛梳顺了。" : state.notice,
    foodOpen: false,
  })),
  setBowl: (kind, portions) => set({ bowl: portions ? { kind, portions } : null }),
  setNotice: (notice) => set({ notice }),
  clearNotice: () => set({ notice: null }),
}));
