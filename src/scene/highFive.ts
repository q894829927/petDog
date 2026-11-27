import { MathUtils, Vector2, Vector3, type AnimationAction, type Camera, type Group } from "three";
import type { PetSide } from "../store/useGameUI";

export type HighFiveState = {
  pointer: { id: number; touch: boolean; ndc: Vector2 } | null;
  offered: boolean;
  handReady: boolean;
  point: Vector3;
  outward: Vector3;
  spots: { L: Vector3; R: Vector3 };
  radius: number;
};

export function createHighFiveState(): HighFiveState {
  return {
    pointer: null, offered: false, handReady: false,
    point: new Vector3(), outward: new Vector3(0, 0, 1),
    spots: { L: new Vector3(), R: new Vector3() }, radius: 0,
  };
}

type Size = { width: number; height: number };
type PawPose = {
  target(side: PetSide, out: Vector3): Vector3;
  apply(side: PetSide, amount: number): void;
};
const sides = ["L", "R"] as const;

export function highFiveSide(hand: HighFiveState, pointer: Vector2, size: Size): PetSide | null {
  if (hand.radius === 0) return null;
  let nearest: PetSide | null = null;
  let best = hand.radius;
  for (const side of sides) {
    const spot = hand.spots[side];
    if (spot.z < -1 || spot.z > 1) continue;
    const distance = Math.hypot((spot.x - pointer.x) * size.width / 2, (spot.y - pointer.y) * size.height / 2);
    if (distance < best) {
      best = distance;
      nearest = side;
    }
  }
  return nearest;
}

export function createSitHighFive(hand: HighFiveState, paw: PawPose) {
  const targets = { L: new Vector3(), R: new Vector3() };
  const view = new Vector3(), forward = new Vector3();
  const anchor = new Vector2();
  let phase: "idle" | "offer" | "tap" | "lower" | "done" = "idle";
  let side: PetSide = "L";
  let owner: HighFiveState["pointer"] = null;
  let elapsed = 0, lift = 0;
  let seated: AnimationAction | null = null;

  function releaseSeat() {
    if (seated) seated.paused = false;
    seated = null;
  }

  return {
    reset() {
      releaseSeat();
      hand.offered = false;
      hand.radius = 0;
      hand.pointer = owner = null;
      phase = "idle";
      lift = elapsed = 0;
    },
    update(action: AnimationAction, dog: Group, camera: Camera, size: Size, eligible: boolean, step: number, onContact: () => void) {
      hand.radius = 0;
      if (eligible) {
        dog.getWorldDirection(forward);
        view.subVectors(camera.position, dog.position).setY(0).normalize();
        if (view.dot(forward) > -0.5) {
          const depth = dog.position.distanceTo(camera.position);
          hand.radius = MathUtils.clamp(0.25 * camera.projectionMatrix.elements[5] * size.height / (2 * depth), 22, 46);
          for (const which of sides) {
            paw.target(which, targets[which]);
            hand.spots[which].copy(targets[which]).project(camera);
          }
        }
      }

      if (!hand.radius) hand.pointer = null;
      const pointer = hand.pointer;
      const candidate = pointer && highFiveSide(hand, pointer.ndc, size);
      const sameOffer = pointer === owner && candidate === side;
      if (!sameOffer) {
        if (phase === "offer" || phase === "done") phase = "idle";
        if (phase === "tap") phase = "lower";
      }
      if (phase === "idle" && pointer && candidate) {
        owner = pointer;
        side = candidate;
        anchor.copy(pointer.ndc);
        elapsed = lift = 0;
        phase = "offer";
      }
      hand.offered = phase === "offer" || phase === "tap";
      if (hand.offered) {
        hand.point.copy(targets[side]);
        hand.outward.copy(hand.point).sub(dog.position).setY(0).normalize();
      }
      if (phase === "offer" && pointer) {
        const travel = Math.hypot((pointer.ndc.x - anchor.x) * size.width / 2, (pointer.ndc.y - anchor.y) * size.height / 2);
        if (travel > (pointer.touch ? 13 : 8)) {
          anchor.copy(pointer.ndc);
          elapsed = 0;
        }
        elapsed += step;
        if (elapsed >= 0.55 && hand.handReady) {
          seated = action;
          seated.paused = true;
          phase = "tap";
          elapsed = 0;
        }
      } else if (phase === "tap") {
        elapsed += step;
        const progress = Math.min(1, elapsed / 0.38);
        if (progress === 1 && lift < 1) onContact();
        lift = progress;
        if (elapsed >= 0.56) phase = "lower";
      } else if (phase === "lower") {
        if (!eligible) releaseSeat();
        lift = Math.max(0, lift - step / 0.32);
        if (lift === 0) {
          releaseSeat();
          phase = sameOffer ? "done" : "idle";
        }
      }
      if (lift > 0) paw.apply(side, MathUtils.smootherstep(lift, 0, 1));
      return eligible && phase !== "idle" && phase !== "done";
    },
  };
}
