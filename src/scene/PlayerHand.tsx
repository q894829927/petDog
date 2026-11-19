import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import {
  Bone, MathUtils, Matrix4, Mesh, Quaternion, Raycaster, Triangle, Vector3,
  type Group, type Material, type Object3D, type SkinnedMesh, type Vector2,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import playerHandUrl from "../assets/player-hand.glb?url";
import { useGameUI, type PetPart } from "../store/useGameUI";
import { createHandClearance } from "./handClearance";
import { hitPetPart } from "./petTouch";

export type HandGesture = PetPart | "brush";

export type HandContact = {
  dog: Group;
  mesh: SkinnedMesh;
  head: Object3D;
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
const contactGrace = 0.11;
const reachTime = 0.15;
const retractTime = 0.23;
const followSpeed = 5.6;
const wristSpeed = 11;

function sampleSurface(target: HandContact, triangle: Triangle, point: Vector3, normal: Vector3) {
  const { a, b, c } = triangle;
  const [ia, ib, ic] = target.vertices;
  target.mesh.getVertexPosition(ia, a).applyMatrix4(target.mesh.matrixWorld);
  target.mesh.getVertexPosition(ib, b).applyMatrix4(target.mesh.matrixWorld);
  target.mesh.getVertexPosition(ic, c).applyMatrix4(target.mesh.matrixWorld);
  point.copy(a).multiplyScalar(target.weights.x).addScaledVector(b, target.weights.y).addScaledVector(c, target.weights.z);
  triangle.getNormal(normal);
}

function handMaterials(group: Group) {
  const materials: Material[] = [];
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const slots = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of slots) {
      material.transparent = true;
      material.needsUpdate = true;
      materials.push(material);
    }
  });
  return materials;
}

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
    hitPoint: new Vector3(),
    hitNormal: new Vector3(),
    point: new Vector3(),
    normal: new Vector3(),
    view: new Vector3(),
    screen: new Vector3(),
    ray: new Raycaster(),
    repickIn: 0,
    outward: new Vector3(),
    nextOutward: new Vector3(),
    forward: new Vector3(),
    strokeDirection: new Vector3(),
    x: new Vector3(),
    y: new Vector3(),
    z: new Vector3(),
    fingertip: new Vector3(),
    goal: new Vector3(),
    basis: new Matrix4(),
    rotation: new Quaternion(),
    offset: new Quaternion(),
    startedAt: null as number | null,
    elapsed: 0,
    phase: 0,
    pressure: 0,
    curl: fingerNames.map((_, finger) => 0.06 + finger * 0.02),
    lastContact: null as HandContact | null,
    missedFor: contactGrace,
    reach: 0,
    clearance: 0,
    materials: null as Material[] | null,
    separate: null as ReturnType<typeof createHandClearance> | null,
  }), []);

  useFrame(({ camera, size }, delta) => {
    const group = hand.current;
    if (!group) return;
    let target = contact.current;
    const { tool, panel, foodOpen } = useGameUI.getState();
    const step = Math.min(delta, 0.05);
    const disabled = tool === "ball" || panel || foodOpen;
    if (disabled || (target && (performance.now() >= target.visibleUntil || (tool === "brush") !== (target.gesture === "brush")))) {
      contact.current = null;
      target = null;
      pose.missedFor = contactGrace;
    }

    const appearing = pose.reach === 0;
    if (appearing && !target) return;
    const blend = 1 - Math.exp(-step * 24);
    pose.repickIn = Math.max(0, pose.repickIn - step);
    if (target) {
      target.dog.updateMatrixWorld(true);
      sampleSurface(target, pose.triangle, pose.hitPoint, pose.hitNormal);
      pose.view.subVectors(camera.position, pose.hitPoint).normalize();
      pose.screen.copy(pose.hitPoint).project(camera);
      const drift = Math.hypot((pose.screen.x - target.screenPoint.x) * size.width, (pose.screen.y - target.screenPoint.y) * size.height);
      if (pose.hitNormal.dot(pose.view) <= 0 || (!target.pressed && target.visibleUntil === Infinity && drift > 85)) {
        // An animated triangle can turn away while the cursor is still on the dog.
        const previous = target;
        target = null;
        if (previous.visibleUntil === Infinity && pose.repickIn === 0) {
          pose.repickIn = 0.08;
          pose.ray.setFromCamera(previous.screenPoint, camera);
          const hit = pose.ray.intersectObject(previous.mesh, false)[0];
          if (hit?.face && hit.barycoord) {
            const part = hitPetPart(hit, previous.head);
            if (tool === "pet" || previous.pressed || part === "back") {
              previous.vertices = [hit.face.a, hit.face.b, hit.face.c];
              previous.weights = hit.barycoord;
              previous.gesture = tool === "brush" ? "brush" : part ?? "head";
              sampleSurface(previous, pose.triangle, pose.hitPoint, pose.hitNormal);
              target = previous;
            }
          }
        }
      }
    }

    if (target) {
      pose.lastContact = target;
      pose.missedFor = 0;
      const distance = pose.point.distanceTo(pose.hitPoint);
      const follow = appearing ? 1 : Math.min(blend, step * followSpeed / Math.max(distance, 0.001));
      pose.point.lerp(pose.hitPoint, follow);
      pose.normal.lerp(pose.hitNormal, follow).normalize();
      pose.forward.set(0, 0, 1).transformDirection(target.dog.matrixWorld);
    } else {
      pose.missedFor += step;
    }
    const reaching = pose.missedFor < contactGrace;
    pose.reach = MathUtils.clamp(pose.reach + (reaching ? step / reachTime : -step / retractTime), 0, 1);
    if (pose.reach === 0 || !pose.lastContact) {
      pose.lastContact = null;
      for (const material of pose.materials ?? []) material.opacity = 0;
      group.visible = false;
      return;
    }

    const last = pose.lastContact;
    group.visible = true;
    if (appearing || pose.startedAt !== last.startedAt) {
      pose.startedAt = last.startedAt;
      pose.elapsed = 0;
    }
    pose.elapsed += step;
    const active = reaching && (last.pressed || (last.startedAt !== null && pose.elapsed < 0.38));
    if (appearing) {
      pose.pressure = 0;
      pose.phase = 0;
      pose.clearance = 0;
    }
    pose.pressure = MathUtils.damp(pose.pressure, Number(active), active ? 19 : 13, step);
    const { gesture } = last;
    const chin = gesture === "chin";
    const alongBack = gesture === "back" || gesture === "brush";
    pose.phase = (pose.phase + step * 2 * Math.PI * (chin ? 3.6 : 1.6)) % (2 * Math.PI);
    const phase = pose.phase;
    const wristMotion = Math.sin(phase) * pose.pressure;
    const highTouch = MathUtils.smoothstep(pose.point.y, 0.26, 0.62);

    // Face the palm down over the head and back, and up under the chin.
    pose.view.subVectors(camera.position, pose.point).normalize();
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
    if (appearing) {
      group.quaternion.copy(pose.rotation);
    } else {
      const angle = group.quaternion.angleTo(pose.rotation);
      const turn = Math.min(1 - Math.exp(-step * 17), step * wristSpeed / Math.max(angle, 0.001));
      group.quaternion.slerp(pose.rotation, turn);
    }

    for (let finger = 0; finger < pose.curl.length; finger++) {
      const curl = MathUtils.lerp(0.06 + finger * 0.02, fingerCurl(gesture, finger, phase), pose.pressure);
      pose.curl[finger] = MathUtils.lerp(pose.curl[finger], curl, appearing ? 1 : blend);
    }
    for (const { bone, rest, finger, joint } of rig.fingers) {
      pose.offset.setFromAxisAngle(bendAxis, -pose.curl[finger] * (joint === 3 ? 0.5 : 1));
      bone.quaternion.copy(rest).multiply(pose.offset);
    }
    rig.tip.getWorldPosition(pose.fingertip);
    pose.nextOutward.copy(pose.normal).multiplyScalar(0.8).addScaledVector(pose.z, 0.85).addScaledVector(pose.view, 0.18);
    if (pose.point.y < 0.46 && pose.nextOutward.y < 0) {
      pose.nextOutward.y = 0;
    }
    pose.outward.lerp(pose.nextOutward.normalize(), appearing ? 1 : blend).normalize();
    pose.goal.copy(pose.point);
    if (gesture === "back") {
      pose.strokeDirection.copy(pose.forward).addScaledVector(pose.normal, -pose.forward.dot(pose.normal));
      pose.goal.addScaledVector(pose.strokeDirection, wristMotion * 0.05);
    }
    const patLift = gesture === "head" ? (1 + Math.cos(phase)) * 0.018 * pose.pressure : 0;
    const retreat = 0.42 * (1 - MathUtils.smoothstep(pose.reach, 0, 1));
    pose.goal.addScaledVector(pose.outward, MathUtils.lerp(0.052, 0.008, pose.pressure) + patLift);
    pose.goal.addScaledVector(pose.view, retreat);
    group.position.add(pose.goal.sub(pose.fingertip));
    group.updateMatrixWorld(true);
    if (!target) last.dog.updateMatrixWorld(true);
    pose.separate ??= createHandClearance(group);
    pose.x.set(1, 0, 0).applyQuaternion(group.quaternion);
    const shift = pose.separate(last.mesh, pose.outward, pose.x);
    pose.clearance = Math.max(shift, MathUtils.damp(pose.clearance, shift, 21, step));
    group.position.addScaledVector(pose.outward, pose.clearance);

    pose.materials ??= handMaterials(group);
    const opacity = MathUtils.smoothstep(pose.reach, 0, 0.72);
    for (const material of pose.materials) material.opacity = opacity;
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
