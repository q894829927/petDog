import { Vector3, type Group, type SkinnedMesh } from "three";

const sideTilt = -0.68;

export function createReclinedPose() {
  const vertex = new Vector3();
  return (rig: Group, mesh: SkinnedMesh, roll: number, grounded: number) => {
    const angle = sideTilt * roll;
    rig.rotation.z = angle;
    rig.position.x = -0.075 * roll;
    if (grounded === 0) {
      rig.position.y = 0;
      return;
    }

    // Keep the supporting flank at rug height as the legs fold and the body rolls.
    rig.updateMatrixWorld(true);
    const sin = Math.sin(angle), cos = Math.cos(angle);
    let lowest = Infinity;
    const count = mesh.geometry.attributes.position.count;
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, vertex);
      lowest = Math.min(lowest, vertex.x * sin + vertex.y * cos);
    }
    rig.position.y = Math.max(0, -lowest - 0.001) * grounded;
  };
}
