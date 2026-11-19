export const personalities = ["playful", "affectionate", "reserved"] as const;
export type Personality = typeof personalities[number];

export const petActions = ["pet", "call", "feed", "drink", "play", "brush", "sleep", "wake"] as const;
export type PetAction = typeof petActions[number];

export type PetSnapshot = {
  name: string;
  personality: Personality;
  adoptedAt: number;
  serverTime: number;
  hunger: number;
  hydration: number;
  energy: number;
  cleanliness: number;
  happiness: number;
  affection: number;
  sleeping: boolean;
  version: number;
};

export type PetActionRequest = {
  action: PetAction;
  requestId: string;
  expectedVersion: number;
};

export type SessionInfo = {
  user: { id: number; email: string } | null;
  registrationOpen: boolean;
};
