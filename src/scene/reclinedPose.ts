import { AnimationClip, Euler, MathUtils, Quaternion, QuaternionKeyframeTrack, Vector3, type Group, type SkinnedMesh } from "three";

const sideTilt = -0.29;
const hipPitch = new Vector3(1, 0, 0);

// Share the hind-leg turn across the hip and thigh to keep the fur smooth.
// The paws rest on one side of the body and the tail settles on the other.
const sidePoseOffsets: Record<string, [number, number, number]> = {
  hip_b_L: [-0.246, 0.184, 0.145],
  thigh_b_L: [0.369, -0.308, -0.11],
  leg_b_L: [-0.047, 0, 0],
  foot_b_L: [0.221, -0.197, -1.008],
  hip_b_R: [-0.025, 0.05, 0.045],
  thigh_b_R: [0.175, -0.012, -0.044],
  leg_b_R: [-0.046, 0, 0],
  foot_b_R: [0.106, 0.257, -0.664],
  leg_f_L: [-0.029, 0.056, 0.002],
  shin_f_L: [0.037, -0.05, 0.003],
  foot_f_L: [0.015, 0.052, 0.048],
  thigh_f_R: [-0.078, -0.148, -0.014],
  leg_f_R: [-0.33, 0.045, 0.02],
  shin_f_R: [0.18, 0.052, -0.012],
  foot_f_R: [0.097, -0.042, -0.043],
  neck: [-0.052, 0.058, 0.003],
  head: [0.068, -0.02, -0.03],
  tail_01: [0.903, -0.579, -0.106],
  tail_02: [0, -0.26, 0],
};

export function rollIntoRecline(time: number, duration: number) {
  return MathUtils.smoothstep(time, 0.95, duration);
}

export function rollOutOfRecline(time: number) {
  return 1 - MathUtils.smoothstep(time, 0, 0.9);
}

export function reclineClips(assets: AnimationClip[]) {
  const rotation = new Quaternion();
  const correction = new Quaternion();
  const motions = [
    { original: "NapDown", name: "ReclineDown", weight: rollIntoRecline, step: [0.58, 0.84, 1.55, 1.83] },
    { original: "Nap", name: "Recline", weight: () => 1, step: null },
    { original: "NapUp", name: "ReclineUp", weight: rollOutOfRecline, step: [0.2, 0.42, 1.28, 1.57] },
  ];
  return motions.map(({ original, name, weight, step }) => {
    const clip = AnimationClip.findByName(assets, original);
    if (!clip) throw new Error(`Akita animation missing: ${original}`);
    const frames = Math.ceil(clip.duration * 24);
    const times = Array.from({ length: frames + 1 }, (_, index) => index * clip.duration / frames);
    const tracks = clip.tracks.map((track) => {
      if (!(track instanceof QuaternionKeyframeTrack)) return track;
      const bone = track.name.replace(/\.quaternion$/, "");
      const angles = sidePoseOffsets[bone];
      if (!angles) return track;
      const finalOffset = new Quaternion().setFromEuler(new Euler(...angles));
      const sample = track.InterpolantFactoryMethodLinear();
      const values: number[] = [];
      for (let index = 0; index < times.length; index++) {
        const time = times[index];
        rotation.fromArray(sample.evaluate(time));
        correction.identity().slerp(finalOffset, weight(time, clip.duration));
        rotation.multiply(correction);
        if (step && bone === "thigh_b_L") {
          // Give the moving hind leg clearance over the planted one during both transitions.
          const [start, lift, lower, end] = step;
          const amount = MathUtils.smoothstep(time, start, lift) * (1 - MathUtils.smoothstep(time, lower, end));
          rotation.multiply(correction.setFromAxisAngle(hipPitch, -0.62 * amount));
        }
        rotation.toArray(values, index * 4);
      }
      return new QuaternionKeyframeTrack(track.name, times, values);
    });
    return new AnimationClip(name, clip.duration, tracks);
  });
}

export function createReclinedPose() {
  const vertex = new Vector3();
  return (rig: Group, mesh: SkinnedMesh, roll: number) => {
    const angle = sideTilt * roll;
    rig.rotation.z = angle;
    rig.position.x = -0.075 * roll;

    // Keep the supporting flank at rug height as the legs fold and the body rolls.
    rig.updateMatrixWorld(true);
    const sin = Math.sin(angle), cos = Math.cos(angle);
    let lowest = Infinity;
    const count = mesh.geometry.attributes.position.count;
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, vertex);
      lowest = Math.min(lowest, vertex.x * sin + vertex.y * cos);
    }
    rig.position.y = Math.max(0, -lowest - 0.001);
  };
}
