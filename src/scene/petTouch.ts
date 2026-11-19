import { SkinnedMesh, Vector3, type Intersection, type Object3D } from "three";
import type { PetPart } from "../store/useGameUI";

export function hitPetPart(event: Pick<Intersection, "object" | "face" | "point">, head: Object3D): PetPart | null {
  const { object, face, point } = event;
  if (!(object instanceof SkinnedMesh) || !face) return null;

  // Skin weights follow the bent pose, including while sitting and walking.
  const { skinIndex, skinWeight } = object.geometry.attributes;
  let bone = object.skeleton.bones[0];
  let largestWeight = 0;
  for (const vertex of [face.a, face.b, face.c]) {
    for (let component = 0; component < 4; component++) {
      const weight = skinWeight.getComponent(vertex, component);
      if (weight <= largestWeight) continue;
      largestWeight = weight;
      bone = object.skeleton.bones[skinIndex.getComponent(vertex, component)];
    }
  }

  if (/^(head|mouth|nose|tongue_|eye_|Ear_)/.test(bone.name)) {
    const hit = head.worldToLocal(point.clone());
    return hit.y < -0.0002 && hit.z < -0.00055 ? "chin" : "head";
  }
  if (bone.name.startsWith("Spine_") && point.y > bone.getWorldPosition(new Vector3()).y) return "back";
  return null;
}
