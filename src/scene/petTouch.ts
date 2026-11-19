import { Matrix4, SkinnedMesh, Triangle, Vector3, Vector4, type Camera, type Intersection, type Vector2 } from "three";
import type { PetTarget } from "../store/useGameUI";

const faceBones = /^(head|mouth|nose|tongue_|eye_)/;
const legBones = /^(hip|thigh|leg|shin|foot|claws)_/;
const touchRadius = 10;
const cameraForward = new Vector3(0, 0, -1);
type TouchHit = Pick<Intersection, "object" | "face" | "barycoord"> & { nearTouch?: true };

export function hitPetTarget(
  { object, face, barycoord, nearTouch }: TouchHit,
  intent: "stroke" | "tap" = "stroke",
): PetTarget | null {
  if (!(object instanceof SkinnedMesh) || !face || !barycoord) return null;

  // Both Akita meshes share the same bind pose (Y up, Z forward). Classify the
  // barycentric point there so the region follows the fur even as it deforms.
  const { position, skinIndex, skinWeight } = object.geometry.attributes;
  const vertices = [face.a, face.b, face.c];
  let x = 0, y = 0, z = 0;
  let head = 0, ears = 0, neck = 0, trunk = 0, legs = 0, paws = 0, tail = 0;
  for (let corner = 0; corner < vertices.length; corner++) {
    const vertex = vertices[corner];
    const portion = barycoord.getComponent(corner);
    x += position.getX(vertex) * portion;
    y += position.getY(vertex) * portion;
    z += position.getZ(vertex) * portion;
    for (let component = 0; component < 4; component++) {
      const weight = portion * skinWeight.getComponent(vertex, component);
      if (weight <= 0) continue;
      const { name } = object.skeleton.bones[skinIndex.getComponent(vertex, component)];
      if (name.startsWith("Ear_")) ears += weight;
      else if (faceBones.test(name)) head += weight;
      else if (name === "neck") neck += weight;
      else if (name.startsWith("Spine_")) trunk += weight;
      else if (legBones.test(name)) {
        legs += weight;
        if (name.startsWith("foot_") || name.startsWith("claws_")) paws += weight;
      }
      else if (name.startsWith("tail_")) tail += weight;
    }
  }

  const side = x >= 0 ? "L" : "R";
  // The center below the tail root is a small spot on the exposed rear surface.
  if (intent === "tap" && !nearTouch && tail < 0.28 && z < -0.222 &&
      (x / 0.029) ** 2 + ((y - 0.374) / 0.021) ** 2 <= 1) return { part: "poke", side };
  if (ears >= 0.29) return { part: "ear", side };
  if (head + ears >= 0.5) {
    if (y < 0.455 && z > 0.312) return { part: "chin" };
    if (y < 0.526 && (z > 0.314 || Math.abs(x) > 0.053)) return { part: "cheek", side };
    return { part: "head" };
  }
  if (tail >= 0.5) return { part: z > -0.303 ? "tailRoot" : "tail", side };
  if (legs >= 0.47 && y < 0.315) {
    return { part: paws > 0.44 || y < 0.065 ? "paw" : "leg", side, hind: z < 0 };
  }
  if (y < 0.31 && z > -0.2 && z < 0.138 && Math.abs(x) < 0.083) return { part: "belly", side };
  if (neck >= 0.45 || (z > 0.148 && y < 0.45)) return { part: "chest", side };
  if (y > 0.425 && trunk + neck > 0.39) return { part: "back", side };
  return { part: "flank", side };
}

export function createNearbyTouchPicker() {
  const meshToClip = new Matrix4();
  const triangle = new Triangle();
  const clip = new Vector4();
  const vertex = new Vector3();
  const origin = new Vector3();
  const closest = new Vector3();
  const weights = new Vector3();
  const chosenWeights = new Vector3();
  let coords = new Float32Array(0);

  return (mesh: SkinnedMesh, camera: Camera, pointer: Vector2, width: number, height: number): (Intersection<SkinnedMesh> & { nearTouch: true }) | null => {
    // Project the current skinned pose once for the whole touch area.
    const { geometry } = mesh;
    const indices = geometry.index!.array;
    const count = geometry.attributes.position.count;
    if (coords.length !== count * 4) coords = new Float32Array(count * 4);
    meshToClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    for (let index = 0; index < count; index++) {
      mesh.getVertexPosition(index, vertex);
      clip.set(vertex.x, vertex.y, vertex.z, 1).applyMatrix4(meshToClip);
      const w = 1 / clip.w;
      const offset = index * 4;
      coords[offset] = (clip.x * w - pointer.x) * width / 2;
      coords[offset + 1] = (clip.y * w - pointer.y) * height / 2;
      coords[offset + 2] = clip.z * w;
      coords[offset + 3] = w;
    }

    let bestDistance = touchRadius ** 2;
    let bestDepth = Infinity;
    let bestFace = -1;
    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index] * 4;
      const b = indices[index + 1] * 4;
      const c = indices[index + 2] * 4;
      const ax = coords[a], bx = coords[b], cx = coords[c];
      const ay = coords[a + 1], by = coords[b + 1], cy = coords[c + 1];
      if (Math.min(ax, bx, cx) > touchRadius || Math.max(ax, bx, cx) < -touchRadius ||
          Math.min(ay, by, cy) > touchRadius || Math.max(ay, by, cy) < -touchRadius) continue;
      triangle.a.set(ax, ay, 0);
      triangle.b.set(bx, by, 0);
      triangle.c.set(cx, cy, 0);
      if (!triangle.isFrontFacing(cameraForward)) continue;
      const distance = triangle.closestPointToPoint(origin, closest).lengthSq();
      if (distance > bestDistance + 0.001 || !triangle.getBarycoord(closest, weights)) continue;
      const depth = coords[a + 2] * weights.x + coords[b + 2] * weights.y + coords[c + 2] * weights.z;
      if (distance >= bestDistance - 0.001 && depth >= bestDepth) continue;
      bestDistance = distance;
      bestDepth = depth;
      bestFace = index;
      // Convert the screen-space weights back to the tracked point on the 3D surface.
      chosenWeights.set(weights.x * coords[a + 3], weights.y * coords[b + 3], weights.z * coords[c + 3]);
      chosenWeights.divideScalar(chosenWeights.x + chosenWeights.y + chosenWeights.z);
    }
    if (bestFace < 0) return null;

    const a = indices[bestFace], b = indices[bestFace + 1], c = indices[bestFace + 2];
    mesh.getVertexPosition(a, triangle.a);
    mesh.getVertexPosition(b, triangle.b);
    mesh.getVertexPosition(c, triangle.c);
    const point = triangle.a.clone().multiplyScalar(chosenWeights.x)
      .addScaledVector(triangle.b, chosenWeights.y).addScaledVector(triangle.c, chosenWeights.z).applyMatrix4(mesh.matrixWorld);
    return {
      object: mesh, point, distance: camera.position.distanceTo(point), barycoord: chosenWeights.clone(),
      face: { a, b, c, normal: triangle.getNormal(new Vector3()), materialIndex: 0 },
      faceIndex: bestFace / 3,
      nearTouch: true,
    };
  };
}
