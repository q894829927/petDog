import { Quaternion, Vector3, type AnimationAction, type Group } from "three";
import type { PetSide } from "../store/useGameUI";

// The seated hold lies between the sit-down and stand-up portions of the Akita clip.
export function isHighFiveSit(action: AnimationAction | null) {
  return action?.getClip().name === "Sit" && action.time >= 0.98 && action.time <= 4.38;
}

// Both meshes use this point on the underside of the main pad in foot-bone units.
const pawPad = new Vector3(0, -0.00015, -0.00035);

export function createAkitaHighFive(scene: Group) {
  function frontLeg(side: PetSide) {
    const shoulder = scene.getObjectByName("thigh_f_" + side);
    const elbow = scene.getObjectByName("leg_f_" + side);
    const foot = scene.getObjectByName("foot_f_" + side);
    if (!shoulder || !elbow || !foot) throw new Error("Missing Akita front leg: " + side);

    // In the seated pose the shoulder swings 31° forward and 21° outward,
    // and the elbow folds 60°. Express those turns in each bone's own basis.
    const left = side === "L";
    const liftShoulder = left ? new Quaternion(-0.26968, 0.04548, 0.16162, 0.9482)
      : new Quaternion(-0.26760, -0.04936, -0.16393, 0.9482);
    const foldElbow = left ? new Quaternion(0.48686, 0.01748, -0.11783, 0.86533)
      : new Quaternion(0.48978, -0.01587, 0.10524, 0.86532);
    return { shoulder, elbow, foot, liftShoulder: liftShoulder.normalize(), foldElbow: foldElbow.normalize() };
  }

  const legs = { L: frontLeg("L"), R: frontLeg("R") };
  const restShoulder = new Quaternion(), restElbow = new Quaternion();
  const previewShoulder = new Quaternion(), previewElbow = new Quaternion();
  const offset = new Quaternion();
  let active: ReturnType<typeof frontLeg> | null = null;

  function restore() {
    if (!active) return;
    active.shoulder.quaternion.copy(restShoulder);
    active.elbow.quaternion.copy(restElbow);
    active.shoulder.updateWorldMatrix(true, true);
    active = null;
  }

  return {
    // Restore before mixer.update so even a paused seated clip supplies a clean base pose.
    restore,
    apply(side: PetSide, lift: number) {
      restore();
      if (lift <= 0) return;
      const leg = legs[side];
      restShoulder.copy(leg.shoulder.quaternion);
      restElbow.copy(leg.elbow.quaternion);
      leg.shoulder.quaternion.multiply(offset.identity().slerp(leg.liftShoulder, lift));
      leg.elbow.quaternion.multiply(offset.identity().slerp(leg.foldElbow, lift));
      leg.shoulder.updateWorldMatrix(true, true);
      active = leg;
    },
    target(side: PetSide, out: Vector3) {
      const leg = legs[side];
      previewShoulder.copy(leg.shoulder.quaternion);
      previewElbow.copy(leg.elbow.quaternion);
      leg.shoulder.quaternion.copy(active === leg ? restShoulder : previewShoulder).multiply(leg.liftShoulder);
      leg.elbow.quaternion.copy(active === leg ? restElbow : previewElbow).multiply(leg.foldElbow);
      leg.foot.localToWorld(out.copy(pawPad));
      leg.shoulder.quaternion.copy(previewShoulder);
      leg.elbow.quaternion.copy(previewElbow);
      leg.shoulder.updateWorldMatrix(true, true);
      return out;
    },
  };
}
