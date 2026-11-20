import {
  AdditiveAnimationBlendMode, AnimationClip, LoopOnce, MathUtils, Quaternion, QuaternionKeyframeTrack, Vector3,
  type AnimationAction, type AnimationMixer,
} from "three";
import type { PetTarget } from "../store/useGameUI";
import type { Personality, PetSnapshot } from "../../shared/pet";

const pitch = new Vector3(1, 0, 0);
const yaw = new Vector3(0, 1, 0);
const roll = new Vector3(0, 0, 1);
const arc = (t: number) => Math.sin(Math.PI * t) ** 2;

type Movement = [bone: string, axis: Vector3, radians: number, flicks?: number, phase?: number];

function reactionClip(name: string, duration: number, movements: Movement[]) {
  const rotation = new Quaternion();
  const samples = 24;
  const times = Array.from({ length: samples + 1 }, (_, i) => duration * i / samples);
  const tracks = movements.map(([bone, axis, radians, flicks, phase = 0]) => {
    const values: number[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const amplitude = flicks ? Math.sin(2 * Math.PI * flicks * t - phase) * Math.sin(Math.PI * t) : arc(t);
      rotation.setFromAxisAngle(axis, radians * amplitude).toArray(values, i * 4);
    }
    return new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
  });
  return new AnimationClip(name, duration, tracks, AdditiveAnimationBlendMode);
}

export function isTailPart(part: string | undefined) {
  return part === "tailRoot" || part === "tail" || part === "rear";
}

type TailMood = Pick<PetSnapshot, "happiness" | "personality" | "sleeping">;
const happyThreshold = 65;
const wagPace: Record<Personality, number> = { playful: 1.16, affectionate: 1, reserved: 0.79 };

function createHappyTailWag(mixer: AnimationMixer) {
  // Express the dog's front-to-back axis in the local bases of the curled tail bones.
  const swingAxis = new Vector3(0, 0.86, 0.5).normalize();
  const followAxis = new Vector3(0.2, 0.02, -0.98).normalize();
  const wags = [2, 3].map((beats) => mixer.clipAction(reactionClip(`Tail wag ${beats}`, 1.6, [
    ["tail_01", swingAxis, 0.44, beats], ["tail_03", followAxis, 0.11, beats, 0.72],
  ])).setLoop(LoopOnce, 1));
  let active: AnimationAction | null = null;
  let wait = MathUtils.randFloat(0.55, 1.15);

  return (step: number, pet: TailMood | null, allowed: boolean) => {
    const happiness = pet?.happiness ?? 78;
    if (!allowed || happiness < happyThreshold || pet?.sleeping) {
      active?.fadeOut(0.18);
      active = null;
      return;
    }
    if (active?.isRunning()) return;

    const mood = MathUtils.smoothstep(happiness, happyThreshold, 100);
    wait -= step * MathUtils.lerp(0.62, 1.4, mood) * wagPace[pet?.personality ?? "playful"];
    if (wait > 0) return;

    const variation = MathUtils.randInt(0, wags.length - 1);
    const duration = MathUtils.randFloat(1.18, 1.64) + variation * 0.22;
    const strength = MathUtils.randFloat(0.62, 0.98) * MathUtils.lerp(0.82, 1, mood);
    active = wags[variation].reset().setDuration(duration).setEffectiveWeight(strength).fadeIn(0.12).play();
    wait = MathUtils.randFloat(3.7, 7.6);
  };
}

function backClip(source: AnimationClip, side: number) {
  const duration = 1.55;
  const times = Array.from({ length: 33 }, (_, i) => duration * i / 32);
  const rotation = new Quaternion();
  const offset = new Quaternion();
  const tracks = source.tracks.filter(({ name }) => name === "head.quaternion" || name === "neck.quaternion")
    .map((track) => {
      const sample = (track as QuaternionKeyframeTrack).InterpolantFactoryMethodLinear();
      const reference = new Quaternion().fromArray(sample.evaluate(0)).invert();
      const values: number[] = [];
      for (let i = 0; i < times.length; i++) {
        offset.fromArray(sample.evaluate(times[i])).premultiply(reference);
        rotation.identity().slerp(offset, arc(i / 32));
        // Reflect the authored look over the other shoulder.
        if (side > 0) rotation.set(rotation.x, -rotation.y, -rotation.z, rotation.w);
        rotation.toArray(values, i * 4);
      }
      return new QuaternionKeyframeTrack(track.name, times, values);
    });
  return new AnimationClip("Back touch", duration, tracks, AdditiveAnimationBlendMode);
}

function makeClip({ part, side = "L", hind }: PetTarget, lookAround: AnimationClip) {
  const direction = side === "L" ? 1 : -1;
  switch (part) {
    case "ear":
      return reactionClip(part, 0.74, [[`Ear_${side}`, roll, 0.43 * direction, 2], ["head", roll, 0.13 * direction]]);
    case "cheek":
      return reactionClip(part, 1.03, [["head", yaw, 0.33 * direction], ["neck", yaw, 0.10 * direction], ["nose", pitch, 0.12, 2]]);
    case "chest":
      return reactionClip(part, 1.42, [["neck", pitch, 0.22], ["head", roll, 0.10 * direction]]);
    case "back":
      return backClip(lookAround, direction);
    case "flank":
      return reactionClip(part, 1.22, [["Spine_03", roll, 0.14 * direction], ["Spine_04", roll, -0.08 * direction], ["head", yaw, 0.18 * direction]]);
    case "leg":
      return reactionClip(part, 0.96, [["head", pitch, -0.34], ["neck", yaw, 0.17 * direction]]);
    case "paw": {
      const leg = `${hind ? "b" : "f"}_${side}`;
      return reactionClip(part, 0.85, [[`thigh_${leg}`, pitch, hind ? -0.18 : 0.23],
        [`leg_${leg}`, pitch, hind ? -0.43 : 0.45], [`foot_${leg}`, pitch, hind ? 0.18 : -0.12], ["head", pitch, -0.16]]);
    }
    case "tailRoot":
      return reactionClip(part, 1.14, [["tail_01", yaw, 0.50, 2.5], ["tail_03", yaw, 0.14, 2.5]]);
    case "tail":
      return reactionClip(part, 0.82, [["tail_03", roll, -0.32 * direction], ["tail_05", roll, -0.32 * direction]]);
    case "belly":
      return reactionClip(part, 1.38, [["foot_f_L", pitch, 0.20], ["foot_f_R", pitch, 0.16], ["Spine_05", pitch, 0.045]]);
    case "rear":
      return reactionClip(part, 1.02, [["tail_01", pitch, 0.69], ["tail_02", pitch, 0.16],
        ["neck", yaw, 0.27 * direction], ["head", yaw, 0.55 * direction]]);
    case "head":
      return reactionClip(part, 1.25, [["head", pitch, -0.19], ["neck", pitch, -0.09]]);
    case "chin":
      return reactionClip(part, 1.38, [["head", pitch, 0.3]]);
  }
}

export function createPetReactions(mixer: AnimationMixer, lookAround: AnimationClip) {
  const actions = new Map<string, AnimationAction>();
  const wag = createHappyTailWag(mixer);
  let current: AnimationAction | null = null;

  return {
    updateTail(step: number, pet: TailMood | null, allowed: boolean) {
      const tailInUse = current?.isRunning() && isTailPart(current.getClip().name);
      wag(step, pet, allowed && !tailInUse);
    },
    play(target: PetTarget) {
      const key = `${target.part}:${target.side ?? "L"}:${target.hind ? "hind" : "front"}`;
      let action = actions.get(key);
      if (!action) {
        action = mixer.clipAction(makeClip(target, lookAround)).setLoop(LoopOnce, 1);
        actions.set(key, action);
      }
      if (action === current && action.isRunning()) return;
      current?.fadeOut(0.16);
      action.reset().setEffectiveWeight(1).fadeIn(0.12).play();
      current = action;
    },
    fade() {
      current?.fadeOut(0.16);
      current = null;
    },
  };
}
