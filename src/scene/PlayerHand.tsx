import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Bone, MathUtils, Matrix4, Quaternion, Triangle, Vector3, type Group, type SkinnedMesh, type Vector2 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import playerHandUrl from "../assets/player-hand.glb?url";
import { useGameUI, type PetPart } from "../store/useGameUI";
import { createHandClearance } from "./handClearance";

export type HandGesture = PetPart | "brush";

export type HandContact = {
  dog: Group;
  mesh: SkinnedMesh;
  vertices: readonly [number, number, number];
  weights: Vector3;
  pointer: number;
  screenPoint: Vector2;
  gesture: HandGesture;
  startedAt: number | null;
  pressed: boolean;
  visibleUntil: number;
};

const bendAxis = new Vector3(0, 0, 1);
const pitchAxis = new Vector3(1, 0, 0);
const worldUp = new Vector3(0, 1, 0);
const fingerNames = ["index", "middle", "ring", "pinky"];

function fingerCurl(gesture: HandGesture, finger: number, phase: number) {
  switch (gesture) {
    case "chin":
      return finger < 2 ? 0.24 + 0.21 * Math.sin(phase + finger * Math.PI) : 0.57;
    case "back":
      return 0.055 + 0.045 * Math.sin(phase - finger * 0.35);
    case "brush":
      return 0.38 + finger * 0.035;
    case "head":
      return 0.1 + 0.10 * (1 - Math.cos(phase)) + finger * 0.025;
  }
}

export function PlayerHand({ contact }: { contact: RefObject<HandContact | null> }) {
  const { scene } = useLoader(GLTFLoader, playerHandUrl);
  const hand = useRef<Group>(null);
  const rig = useMemo(() => {
    const tip = scene.getObjectByName("player_hand_tip");
    if (!tip) throw new Error("Player hand fingertip missing");
    const fingers: { bone: Bone; rest: Quaternion; finger: number; joint: number }[] = [];
    scene.traverse((child) => {
      if (!(child instanceof Bone)) return;
      const match = /^(index|middle|ring|pinky)_0([123])_r$/.exec(child.name);
      if (!match) return;
      fingers.push({ bone: child, rest: child.quaternion.clone(), finger: fingerNames.indexOf(match[1]), joint: Number(match[2]) });
    });
    return { tip, fingers };
  }, [scene]);
  const pose = useMemo(() => ({
    triangle: new Triangle(),
    point: new Vector3(),
    normal: new Vector3(),
    view: new Vector3(),
    screen: new Vector3(),
    outward: new Vector3(),
    forward: new Vector3(),
    strokeDirection: new Vector3(),
    x: new Vector3(),
    y: new Vector3(),
    z: new Vector3(),
    fingertip: new Vector3(),
    basis: new Matrix4(),
    rotation: new Quaternion(),
    offset: new Quaternion(),
    startedAt: null as number | null,
    elapsed: 0,
    pressure: 0,
    separate: null as ReturnType<typeof createHandClearance> | null,
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
    const step = Math.min(delta, 0.05);
    if (pose.startedAt !== target.startedAt) {
      pose.startedAt = target.startedAt;
      pose.elapsed = 0;
    }
    pose.elapsed += step;
    const active = target.pressed || (target.startedAt !== null && pose.elapsed < 0.38);
    if (appearing) pose.pressure = 0;
    pose.pressure = MathUtils.damp(pose.pressure, Number(active), active ? 19 : 13, step);
    const { gesture } = target;
    const chin = gesture === "chin";
    const alongBack = gesture === "back" || gesture === "brush";
    const phase = pose.elapsed * 2 * Math.PI * (chin ? 3.6 : 1.6);
    const wristMotion = Math.sin(phase) * pose.pressure;
    const highTouch = MathUtils.smoothstep(pose.point.y, 0.26, 0.62);

    // Face the palm down over the head and back, and up under the chin.
    pose.forward.set(0, 0, 1).transformDirection(target.dog.matrixWorld);
    pose.z.copy(pose.normal).multiplyScalar(0.58).addScaledVector(pose.view, 0.62);
    pose.z.addScaledVector(worldUp, chin ? -1.1 : 0.35 + 0.75 * highTouch).normalize();
    if (alongBack) {
      // Reach in from the side with the wrist toward the shoulders, clear of the tail.
      pose.y.copy(pose.view).negate().addScaledVector(pose.forward, -0.92);
    } else {
      pose.y.copy(pose.forward).negate().addScaledVector(pose.view, -0.48);
      // Keep the cuff clear of the face when the dog looks straight at the camera.
      const frontal = MathUtils.smoothstep(pose.forward.dot(pose.view), 0.84, 0.98);
      pose.x.set(1, 0, 0).applyQuaternion(camera.quaternion);
      pose.y.addScaledVector(pose.x, frontal * (chin ? 0.85 : 1.3));
      pose.y.addScaledVector(worldUp, (chin ? 0.24 : 0.34) * highTouch);
    }
    pose.y.addScaledVector(pose.z, -pose.y.dot(pose.z)).normalize();
    pose.x.crossVectors(pose.y, pose.z);
    pose.rotation.setFromRotationMatrix(pose.basis.makeBasis(pose.x, pose.y, pose.z));
    const pitch = chin ? -0.38 + 0.07 * wristMotion : -0.61 + pose.pressure * 0.12 + (alongBack ? 0.055 : 0.15) * wristMotion;
    pose.rotation.multiply(pose.offset.setFromAxisAngle(pitchAxis, pitch));
    pose.rotation.multiply(pose.offset.setFromAxisAngle(bendAxis, (alongBack ? 0.14 : 0.045) * wristMotion));
    if (appearing) group.quaternion.copy(pose.rotation);
    else group.quaternion.slerp(pose.rotation, 1 - Math.exp(-step * 26));

    for (const { bone, rest, finger, joint } of rig.fingers) {
      const curl = MathUtils.lerp(0.06 + finger * 0.02, fingerCurl(gesture, finger, phase), pose.pressure);
      pose.offset.setFromAxisAngle(bendAxis, -curl * (joint === 3 ? 0.5 : 1));
      bone.quaternion.copy(rest).multiply(pose.offset);
    }
    rig.tip.getWorldPosition(pose.fingertip);
    pose.outward.copy(pose.normal).multiplyScalar(0.8).addScaledVector(pose.z, 0.85).addScaledVector(pose.view, 0.18).normalize();
    if (pose.point.y < 0.46 && pose.outward.y < 0) {
      pose.outward.y = 0;
      pose.outward.normalize();
    }
    if (gesture === "back") {
      pose.strokeDirection.copy(pose.forward).addScaledVector(pose.normal, -pose.forward.dot(pose.normal));
      pose.point.addScaledVector(pose.strokeDirection, wristMotion * 0.05);
    }
    const patLift = gesture === "head" ? (1 + Math.cos(phase)) * 0.018 * pose.pressure : 0;
    pose.point.addScaledVector(pose.outward, MathUtils.lerp(0.052, 0.008, pose.pressure) + patLift);
    group.position.add(pose.point.sub(pose.fingertip));
    group.updateMatrixWorld(true);
    pose.separate ??= createHandClearance(group);
    const shift = pose.separate(target.mesh, pose.outward, pose.x);
    group.position.addScaledVector(pose.outward, shift);
  });

  return (
    <group name="Player hand" ref={hand} visible={false} scale={3.45}>
      {/* Reflect the imported +Z palm toward the fur and restore the right-hand thumb. */}
      <group name="Player palm" scale={[1, 1, -1]}>
        <primitive object={scene} />
      </group>
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
