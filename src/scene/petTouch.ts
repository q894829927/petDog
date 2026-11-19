import { SkinnedMesh, Vector3, type Intersection, type Object3D } from "three";
import type { PetPart } from "../store/useGameUI";

const headBones = /^(head|mouth|nose|tongue_|eye_|Ear_)/;

export function hitPetPart(
  { object, face, point, barycoord }: Pick<Intersection, "object" | "face" | "point" | "barycoord">,
  head: Object3D,
): PetPart | null {
  if (!(object instanceof SkinnedMesh) || !face || !barycoord) return null;

  // Interpolate the anatomical regions at the actual hit inside the skinned triangle.
  const { skinIndex, skinWeight } = object.geometry.attributes;
  const vertices = [face.a, face.b, face.c];
  let headWeight = 0;
  let spineWeight = 0;
  let spineHeight = 0;
  for (let corner = 0; corner < vertices.length; corner++) {
    const vertex = vertices[corner];
    const portion = barycoord.getComponent(corner);
    for (let component = 0; component < 4; component++) {
      const weight = portion * skinWeight.getComponent(vertex, component);
      if (weight <= 0) continue;
      const bone = object.skeleton.bones[skinIndex.getComponent(vertex, component)];
      if (headBones.test(bone.name)) {
        headWeight += weight;
      } else if (bone.name.startsWith("Spine_")) {
        spineWeight += weight;
        spineHeight += bone.matrixWorld.elements[13] * weight;
      }
    }
  }

  if (headWeight > 0.5) {
    const hit = head.worldToLocal(new Vector3().copy(point));
    return hit.y < -0.0002 && hit.z < -0.00055 ? "chin" : "head";
  }
  if (spineWeight > 0.5 && point.y * spineWeight > spineHeight) return "back";
  return null;
}
