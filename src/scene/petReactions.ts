import {
  AdditiveAnimationBlendMode, AnimationClip, LoopOnce, Quaternion, QuaternionKeyframeTrack, Vector3,
  type AnimationAction, type AnimationMixer,
} from "three";
import type { PetTarget } from "../store/useGameUI";

const pitch = new Vector3(1, 0, 0);
const yaw = new Vector3(0, 1, 0);
const roll = new Vector3(0, 0, 1);
const arc = (t: number) => Math.sin(Math.PI * t) ** 2;

type Movement = [bone: string, axis: Vector3, radians: number, flicks?: number];

function reactionClip(name: string, duration: number, movements: Movement[]) {
  const rotation = new Quaternion();
  const samples = 24;
  const times = Array.from({ length: samples + 1 }, (_, i) => duration * i / samples);
  const tracks = movements.map(([bone, axis, radians, flicks]) => {
    const values: number[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const amplitude = (flicks ? Math.sin(2 * Math.PI * flicks * t) : 1) * arc(t);
      rotation.setFromAxisAngle(axis, radians * amplitude).toArray(values, i * 4);
    }
    return new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
  });
  return new AnimationClip(name, duration, tracks, AdditiveAnimationBlendMode);
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

function makeClip({ part, side = "L" }: PetTarget, lookAround: AnimationClip) {
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
    case "head":
      return reactionClip(part, 1.25, [["head", pitch, -0.19], ["neck", pitch, -0.09]]);
    case "chin":
      return reactionClip(part, 1.38, [["head", pitch, 0.3]]);
  }
}

export function createPetReactions(mixer: AnimationMixer, lookAround: AnimationClip) {
  const actions = new Map<string, AnimationAction>();
  let current: AnimationAction | null = null;

  return {
    play(target: PetTarget) {
      const key = `${target.part}:${target.side ?? "L"}`;
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
