import type { PetAction, PetSnapshot } from "../../../shared/pet.js";

const perHour = { hunger: 5, hydration: 8, energy: 3, sleepRecovery: 360, cleanliness: 1.2, happiness: 1.5 };
type Need = "hunger" | "hydration" | "energy" | "cleanliness" | "happiness" | "affection";

const effects: Record<PetAction, Partial<Record<Need, number>>> = {
  feed: { hunger: 24, happiness: 3, affection: 1 },
  drink: { hydration: 30, happiness: 2 },
  play: { energy: -8, happiness: 7, affection: 3 },
  brush: { cleanliness: 18, happiness: 3, affection: 2 },
  pet: { happiness: 2, affection: 1 },
  call: { affection: 1 },
  sleep: {},
  wake: {},
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function settle(pet: PetSnapshot, now: number): PetSnapshot {
  const serverTime = Math.max(pet.serverTime, now);
  const hours = (serverTime - pet.serverTime) / 3_600_000;
  return {
    ...pet,
    serverTime,
    hunger: clamp(pet.hunger - hours * perHour.hunger),
    hydration: clamp(pet.hydration - hours * perHour.hydration),
    energy: clamp(pet.energy + hours * (pet.sleeping ? perHour.sleepRecovery : -perHour.energy)),
    cleanliness: clamp(pet.cleanliness - hours * perHour.cleanliness),
    happiness: clamp(pet.happiness - hours * perHour.happiness),
  };
}

export function applyEffect(pet: PetSnapshot, action: PetAction): PetSnapshot {
  const next = { ...pet, sleeping: action === "sleep" };
  for (const [key, amount] of Object.entries(effects[action]) as [Need, number][]) {
    next[key] = clamp(pet[key] + amount);
  }
  return next;
}
