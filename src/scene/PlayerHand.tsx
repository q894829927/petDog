import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Bone, MathUtils, Matrix4, Quaternion, Triangle, Vector3, type Group, type SkinnedMesh, type Vector2 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import playerHandUrl from "../assets/player-hand.glb?url";
import { useGameUI } from "../store/useGameUI";

export type HandContact = {
  dog: Group;
  mesh: SkinnedMesh;
  vertices: readonly [number, number, number];
  weights: Vector3;
  pointer: number;
  screenPoint: Vector2;
  pressed: boolean;
  visibleUntil: number;
};

const bendAxis = new Vector3(0, 0, 1);
const palmAxis = new Vector3(1, 0, 0);

export function PlayerHand({ contact }: { contact: RefObject<HandContact | null> }) {
  const { scene } = useLoader(GLTFLoader, playerHandUrl);
  const hand = useRef<Group>(null);
  const rig = useMemo(() => {
    const tip = scene.getObjectByName("player_hand_tip");
    if (!tip) throw new Error("Player hand fingertip missing");
    const fingers: { bone: Bone; rest: Quaternion }[] = [];
    scene.traverse((child) => {
      if (child instanceof Bone && /^(index|middle|ring|pinky)_0[12]_r$/.test(child.name)) {
        fingers.push({ bone: child, rest: child.quaternion.clone() });
      }
    });
    return { tip, fingers };
  }, [scene]);
  const pose = useMemo(() => ({
    triangle: new Triangle(),
    point: new Vector3(),
    normal: new Vector3(),
    view: new Vector3(),
    screen: new Vector3(),
    x: new Vector3(),
    y: new Vector3(),
    z: new Vector3(),
    fingertip: new Vector3(),
    basis: new Matrix4(),
    rotation: new Quaternion(),
    offset: new Quaternion(),
    pressure: 0,
  }), []);

  useFrame(({ camera, size }, delta) => {
    const group = hand.current;
    if (!group) return;
    const target = contact.current;
    const { tool, panel, foodOpen } = useGameUI.getState();
    if (!target || performance.now() >= target.visibleUntil || tool === "ball" || panel || foodOpen) {
      contact.current = null;
      group.visible = false;
      return;
    }

    // Rebuild the hit triangle from the animated skin so the touch follows the fur.
    target.dog.updateMatrixWorld(true);
    const { a, b, c } = pose.triangle;
    const [ia, ib, ic] = target.vertices;
    target.mesh.getVertexPosition(ia, a).applyMatrix4(target.mesh.matrixWorld);
    target.mesh.getVertexPosition(ib, b).applyMatrix4(target.mesh.matrixWorld);
    target.mesh.getVertexPosition(ic, c).applyMatrix4(target.mesh.matrixWorld);
    pose.point.copy(a).multiplyScalar(target.weights.x).addScaledVector(b, target.weights.y).addScaledVector(c, target.weights.z);
    pose.triangle.getNormal(pose.normal);
    pose.view.subVectors(camera.position, pose.point).normalize();
    pose.screen.copy(pose.point).project(camera);
    const drift = Math.hypot((pose.screen.x - target.screenPoint.x) * size.width, (pose.screen.y - target.screenPoint.y) * size.height);
    if (pose.normal.dot(pose.view) <= 0 || (!target.pressed && target.visibleUntil === Infinity && drift > 85)) {
      group.visible = false;
      return;
    }

    const appearing = !group.visible;
    group.visible = true;
    pose.pressure = appearing ? Number(target.pressed) : MathUtils.damp(pose.pressure, Number(target.pressed), 25, delta);
    // The cuff comes in from the right and stays level with low touches near the floor.
    const fromBelow = MathUtils.smoothstep(pose.point.y, 0.16, 0.65);
    pose.z.copy(pose.view).addScaledVector(pose.normal, 0.5).normalize();
    pose.y.set(-0.68, 0.78 * fromBelow, 0).applyQuaternion(camera.quaternion);
    pose.y.addScaledVector(pose.z, -pose.y.dot(pose.z)).normalize();
    pose.x.crossVectors(pose.y, pose.z);
    pose.rotation.setFromRotationMatrix(pose.basis.makeBasis(pose.x, pose.y, pose.z));
    pose.rotation.multiply(pose.offset.setFromAxisAngle(palmAxis, -0.61 + pose.pressure * 0.08));
    if (appearing) group.quaternion.copy(pose.rotation);
    else group.quaternion.slerp(pose.rotation, 1 - Math.exp(-delta * 25));

    pose.offset.setFromAxisAngle(bendAxis, pose.pressure * 0.14);
    for (const { bone, rest } of rig.fingers) bone.quaternion.copy(rest).multiply(pose.offset);
    rig.tip.getWorldPosition(pose.fingertip);
    // Put the fingertip just outside the surface and let depth testing draw the scene.
    pose.point.addScaledVector(pose.normal, MathUtils.lerp(0.052, 0.015, pose.pressure));
    group.position.add(pose.point.sub(pose.fingertip));
  });

  return (
    <group name="Player hand" ref={hand} visible={false} scale={3.45}>
      <primitive object={scene} />
      <mesh position={[0, -0.041, 0]} scale={[1, 1, 0.71]}>
        <cylinderGeometry args={[0.034, 0.044, 0.1, 20]} />
        <meshStandardMaterial color="#7e8d78" roughness={1} />
      </mesh>
      <mesh position={[0, 0.011, 0]} scale={[1, 1, 0.67]}>
        <cylinderGeometry args={[0.035, 0.036, 0.019, 20]} />
        <meshStandardMaterial color="#677c69" roughness={1} />
      </mesh>
    </group>
  );
}
