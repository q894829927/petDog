import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import {
  Bone, MathUtils, Matrix4, Mesh, Quaternion, Raycaster, Triangle, Vector2, Vector3,
  type Group, type Material, type Object3D, type SkinnedMesh,
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
const palmPad = new Vector3(-0.013, 0.104, -0.016);
const indexPad = new Vector3(0, 0.023, 0);
const fingerNames = ["index", "middle", "ring", "pinky", "thumb"];
const restCurls = [0.06, 0.08, 0.1, 0.12, 0.035];
const thumbCurls: Record<HandGesture, number> = { head: 0.105, chin: 0.22, back: 0.105, brush: 0.24 };
const palmContact: Record<HandGesture, number> = { head: 0.3, chin: 0, back: 0.82, brush: 0.26 };
const contactGrace = 0.11;
const reachTime = 0.15;
const retractTime = 0.23;
const gestureDelay = 0.065;
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

function fingerCurl(gesture: HandGesture, finger: number, phase: number, stroke: number) {
  if (finger === 4) return thumbCurls[gesture];
  switch (gesture) {
    case "chin":
      return finger < 2 ? 0.23 + 0.19 * Math.sin(phase + finger * 2.45) : 0.47 + finger * 0.034;
    case "back":
      return 0.10 + finger * 0.022 + 0.036 * stroke;
    case "brush":
      return 0.36 + finger * 0.035;
    case "head":
      return 0.112 + finger * 0.023 + (0.062 - finger * 0.008) * stroke;
  }
}

export function PlayerHand({ contact }: { contact: RefObject<HandContact | null> }) {
  const { scene } = useLoader(GLTFLoader, playerHandUrl);
  const hand = useRef<Group>(null);
  const rig = useMemo(() => {
    const tip = scene.getObjectByName("player_hand_tip");
    const index = scene.getObjectByName("index_03_r");
    if (!tip || !index) throw new Error("Player hand fingertip missing");
    const fingers: { bone: Bone; rest: Quaternion; finger: number; bend: number }[] = [];
    scene.traverse((child) => {
      if (!(child instanceof Bone)) return;
      const match = /^(index|middle|ring|pinky|thumb)_0([123])_r$/.exec(child.name);
      if (!match) return;
      const finger = fingerNames.indexOf(match[1]);
      const joint = Number(match[2]);
      const bend = finger === 4 ? (joint === 1 ? 1 : 0.5) : (joint === 3 ? 0.5 : 1);
      fingers.push({ bone: child, rest: child.quaternion.clone(), finger, bend });
    });
    return { tip, index, fingers };
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
    indexPad: new Vector3(),
    palmPad: new Vector3(),
    goal: new Vector3(),
    basis: new Matrix4(),
    rotation: new Quaternion(),
    offset: new Quaternion(),
    startedAt: null as number | null,
    elapsed: 0,
    phase: 0,
    pressure: 0,
    curl: [...restCurls],
    palmMix: 0,
    chinMix: 0,
    inputMotion: new Vector2(),
    drag: new Vector2(),
    dragged: false,
    gesture: "head" as HandGesture,
    candidate: "head" as HandGesture,
    candidateFor: 0,
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
            if (part && (tool === "pet" || part === "back")) {
              previous.vertices = [hit.face.a, hit.face.b, hit.face.c];
              previous.weights = hit.barycoord;
              previous.gesture = tool === "brush" ? "brush" : part;
              sampleSurface(previous, pose.triangle, pose.hitPoint, pose.hitNormal);
              target = previous;
            }
          }
        }
      }
    }

    pose.inputMotion.set(0, 0);
    const previous = pose.lastContact;
    if (target?.pressed && previous?.pressed && previous.pointer === target.pointer && previous.startedAt === target.startedAt) {
      pose.inputMotion.subVectors(target.screenPoint, previous.screenPoint);
      pose.inputMotion.x *= size.width * 0.5;
      pose.inputMotion.y *= size.height * 0.5;
      pose.inputMotion.divideScalar(Math.max(1, step * 360)).clampLength(0, 1);
    }
    pose.drag.lerp(pose.inputMotion, appearing ? 1 : 1 - Math.exp(-step * 18));
    const dragAmount = pose.drag.length();

    if (target) {
      pose.lastContact = target;
      pose.missedFor = 0;
      const distance = pose.point.distanceTo(pose.hitPoint);
      const speed = followSpeed + 2.6 * dragAmount;
      const followBlend = 1 - Math.exp(-step * (24 + 12 * dragAmount));
      const follow = appearing ? 1 : Math.min(followBlend, step * speed / Math.max(distance, 0.001));
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
    const newPress = last.startedAt !== null && pose.startedAt !== last.startedAt;
    if (appearing || newPress) {
      pose.startedAt = last.startedAt;
      pose.elapsed = 0;
      pose.dragged = last.pressed && !newPress;
    }
    if (pose.inputMotion.lengthSq() > 0.045) pose.dragged = true;
    pose.elapsed += step;
    if (pose.candidate !== last.gesture) {
      pose.candidate = last.gesture;
      pose.candidateFor = 0;
    }
    pose.candidateFor += step;
    if (appearing || newPress || pose.candidateFor >= gestureDelay) pose.gesture = pose.candidate;
    const active = reaching && (last.pressed || (last.startedAt !== null && pose.elapsed < 0.38));
    if (appearing) {
      pose.pressure = 0;
      pose.phase = 0;
      pose.clearance = 0;
      pose.palmMix = 0;
      pose.chinMix = Number(pose.gesture === "chin");
    }
    pose.pressure = MathUtils.damp(pose.pressure, Number(active), active ? 19 : 13, step);
    const { gesture } = pose;
    const chin = gesture === "chin";
    const alongBack = gesture === "back" || gesture === "brush";
    const scratchRate = 3.15 + 0.35 * Math.sin(pose.elapsed * 2);
    if (chin) pose.phase = (pose.phase + step * 2 * Math.PI * scratchRate) % (2 * Math.PI);
    const phase = pose.phase;
    const scratch = Math.sin(phase);
    // A tap gives one soft stroke. Further movement comes from the player's drag.
    const pulse = pose.startedAt === null || pose.dragged ? 0 : Math.sin(Math.PI * MathUtils.smoothstep(pose.elapsed, 0.025, 0.45));
    const stroke = Math.max(pulse, dragAmount);
    const highTouch = MathUtils.smoothstep(pose.point.y, 0.26, 0.62);
    const crown = MathUtils.smoothstep(pose.normal.y, 0.15, 0.72);

    // Face the palm down over the head and back, and up under the chin.
    pose.view.subVectors(camera.position, pose.point).normalize();
    const pettingBack = gesture === "back";
    pose.z.copy(pose.normal).multiplyScalar(pettingBack ? 1.15 : chin ? 0.58 : 0.58 + 0.26 * pose.pressure);
    pose.z.addScaledVector(pose.view, pettingBack ? 0.28 : 0.62);
    pose.z.addScaledVector(worldUp, chin ? -1.1 : pettingBack ? 0.34 : 0.35 + 0.75 * highTouch).normalize();
    if (alongBack) {
      // Reach across the back so the fingers do not point into the curled tail.
      pose.y.copy(pose.view).negate();
      pose.y.addScaledVector(pose.forward, pettingBack ? 0.60 : -0.92);
    } else {
      pose.y.copy(pose.forward).negate().addScaledVector(pose.view, -0.48);
      // Keep the cuff clear of the face when the dog looks straight at the camera.
      const frontal = MathUtils.smoothstep(pose.forward.dot(pose.view), 0.84, 0.98);
      pose.x.set(1, 0, 0).applyQuaternion(camera.quaternion);
      pose.y.addScaledVector(pose.x, frontal * (chin ? 0.85 : 1.55));
      pose.y.addScaledVector(worldUp, chin ? 0.24 * highTouch : 0.26 * highTouch - 1.55 * frontal);
    }
    pose.y.addScaledVector(pose.z, -pose.y.dot(pose.z)).normalize();
    pose.x.crossVectors(pose.y, pose.z);
    pose.rotation.setFromRotationMatrix(pose.basis.makeBasis(pose.x, pose.y, pose.z));
    pose.strokeDirection.set(pose.drag.x, pose.drag.y, 0).applyQuaternion(camera.quaternion);
    const restingPitch = chin ? -0.42 : -0.59;
    const touchingPitch = chin ? -0.35 : alongBack ? (pettingBack ? -0.04 : -0.25) : MathUtils.lerp(-0.47, -0.31, crown);
    const wristMotion = (chin ? 0.045 * scratch : -0.068 * stroke) * pose.pressure;
    const pitch = MathUtils.lerp(restingPitch, touchingPitch, pose.pressure) + wristMotion - 0.064 * pose.strokeDirection.dot(pose.y);
    const roll = (chin ? 0.022 * scratch : 0.055 * pulse) * pose.pressure - 0.16 * pose.strokeDirection.dot(pose.x);
    pose.rotation.multiply(pose.offset.setFromAxisAngle(pitchAxis, pitch));
    pose.rotation.multiply(pose.offset.setFromAxisAngle(bendAxis, roll));
    if (pettingBack) {
      // Keep the lower, near edge of the palm resting on the curved back.
      pose.rotation.multiply(pose.offset.setFromAxisAngle(worldUp, 0.24 * pose.pressure));
    }
    if (appearing) {
      group.quaternion.copy(pose.rotation);
    } else {
      const angle = group.quaternion.angleTo(pose.rotation);
      const turn = Math.min(1 - Math.exp(-step * 17), step * wristSpeed / Math.max(angle, 0.001));
      group.quaternion.slerp(pose.rotation, turn);
    }

    for (let finger = 0; finger < pose.curl.length; finger++) {
      const curl = MathUtils.lerp(restCurls[finger], fingerCurl(gesture, finger, phase, stroke), pose.pressure);
      pose.curl[finger] = MathUtils.lerp(pose.curl[finger], curl, appearing ? 1 : blend);
    }
    for (const { bone, rest, finger, bend } of rig.fingers) {
      pose.offset.setFromAxisAngle(bendAxis, -pose.curl[finger] * bend);
      bone.quaternion.copy(rest).multiply(pose.offset);
    }
    rig.tip.getWorldPosition(pose.fingertip);
    pose.chinMix = MathUtils.lerp(pose.chinMix, Number(chin), blend);
    if (pose.chinMix > 0.001) {
      rig.index.localToWorld(pose.indexPad.copy(indexPad));
      const lead = 0.32 + 0.18 * Math.sin(phase + 0.45);
      pose.fingertip.lerp(pose.indexPad, pose.chinMix * lead);
    }
    pose.z.set(0, 0, 1).applyQuaternion(group.quaternion);
    const aligned = MathUtils.smoothstep(pose.normal.dot(pose.z), 0.45, 0.84);
    // Lead with the finger pads along the cheeks and let the palm settle on flatter fur.
    const palmWeight = gesture === "head" ? palmContact.head * MathUtils.lerp(0.25, 1, crown) : palmContact[gesture];
    pose.palmMix = MathUtils.lerp(pose.palmMix, palmWeight * pose.pressure * aligned, blend);
    pose.palmPad.copy(palmPad).applyMatrix4(group.matrixWorld);
    pose.fingertip.lerp(pose.palmPad, pose.palmMix);

    pose.nextOutward.copy(pose.normal).multiplyScalar(0.8).addScaledVector(pose.z, 0.85).addScaledVector(pose.view, 0.18);
    if (pose.point.y < 0.46 && pose.nextOutward.y < 0) {
      pose.nextOutward.y = 0;
    }
    pose.outward.lerp(pose.nextOutward.normalize(), appearing ? 1 : blend).normalize();
    pose.goal.copy(pose.point);
    if (gesture === "head" || gesture === "back") {
      pose.strokeDirection.copy(pose.forward).addScaledVector(pose.normal, -pose.forward.dot(pose.normal));
      pose.goal.addScaledVector(pose.strokeDirection, -(gesture === "back" ? 0.068 : 0.035) * pulse * pose.pressure);
    }
    const retreat = 0.42 * (1 - MathUtils.smoothstep(pose.reach, 0, 1));
    pose.goal.addScaledVector(pose.outward, MathUtils.lerp(0.052, 0.008, pose.pressure));
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
      <mesh position={[0, -0.026, 0]} scale={[1, 1, 0.71]}>
        <cylinderGeometry args={[0.034, 0.039, 0.07, 20]} />
        <meshStandardMaterial color="#7e8d78" roughness={1} />
      </mesh>
      <mesh position={[0, 0.011, 0]} scale={[1, 1, 0.67]}>
        <cylinderGeometry args={[0.035, 0.036, 0.019, 20]} />
        <meshStandardMaterial color="#677c69" roughness={1} />
      </mesh>
    </group>
  );
}
