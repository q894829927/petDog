import { Vector3, type AnimationAction, type Skeleton } from "three";
import { playPawStep } from "./roomAudio";
import { floorMaterialAt, type FloorPoint } from "./roomNavigation";

// Contact phases sampled from the exported Akita gait clips. Carry shares the walk cycle.
const walkContacts = [
  [0.267, "claws_f_R", 1], [0.283, "claws_b_L", 0.74],
  [0.775, "claws_f_L", 1], [0.8, "claws_b_R", 0.74],
] as const;
const runContacts = [
  [0.108, "claws_f_R", 1.18], [0.492, "claws_b_L", 0.9],
  [0.617, "claws_b_R", 0.9], [0.975, "claws_f_L", 1.18],
] as const;

export function createAkitaFootsteps(skeleton: Skeleton) {
  let previousAction: AnimationAction | undefined;
  let previousPhase = 0;
  let previousX = 0;
  let previousZ = 0;
  const pawPoint = new Vector3();

  return (action: AnimationAction, position: FloorPoint, step: number) => {
    const clip = action.getClip();
    const start = previousPhase;
    const end = action.time / clip.duration;
    const advancing = previousAction === action &&
      Math.hypot(position.x - previousX, position.z - previousZ) > 0.25 * step;
    previousPhase = end;
    previousAction = action;
    previousX = position.x;
    previousZ = position.z;
    const contacts = clip.name === "Run" ? runContacts : clip.name === "Walk" || clip.name === "Carry" ? walkContacts : null;
    if (!advancing || !contacts) return;

    for (const [phase, bone, intensity] of contacts) {
      const crossed = end >= start ? phase > start && phase <= end : phase > start || phase <= end;
      if (!crossed) continue;
      const paw = skeleton.getBoneByName(bone);
      if (paw) playPawStep(floorMaterialAt(paw.getWorldPosition(pawPoint)), intensity);
    }
  };
}
