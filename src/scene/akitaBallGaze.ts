import { Quaternion, Vector3, type Object3D } from "three";

export function createAkitaBallGaze(head: Object3D) {
  // The Akita's muzzle points along the head bone's local negative Z axis.
  const forward = new Vector3(0, 0, -1);
  const direction = new Vector3();
  const neutral = new Quaternion();
  const desired = new Quaternion();
  const offset = new Quaternion();
  const animated = new Quaternion();
  let applied = false;

  return {
    restore() {
      if (applied) head.quaternion.copy(animated);
    },
    update(target: Vector3 | null, step: number) {
      desired.identity();
      if (target) {
        head.worldToLocal(direction.copy(target)).normalize();
        desired.setFromUnitVectors(forward, direction);
        const angle = neutral.angleTo(desired);
        if (angle > 0.48) desired.slerp(neutral, 1 - 0.48 / angle);
      }
      offset.slerp(desired, 1 - Math.exp(-9 * step));
      applied = neutral.angleTo(offset) > 0.001;
      if (applied) {
        animated.copy(head.quaternion);
        head.quaternion.multiply(offset);
      }
    },
  };
}
