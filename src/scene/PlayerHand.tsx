import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import {
  Bone, Euler, MathUtils, Matrix4, Mesh, Quaternion, Raycaster, Triangle, Vector2, Vector3,
  type Group, type Material,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import playerHandUrl from "../assets/player-hand.glb?url";
import { useGameUI, type PetPart } from "../store/useGameUI";
import { createHandClearance } from "./handClearance";
import { hitPetTarget, samplePetSurface, type PetSurface } from "./petTouch";
import { ballGripCloseTime, ballPutBackTime, type BallState } from "./TennisBall";

export type HandGesture = PetPart | "brush";

export type HandContact = PetSurface & {
  dog: Group;
  pointer: number;
  touch: boolean;
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
const ballGripCenter = new Vector3(-0.02233, 0.10959, -0.04808);
const indexPad = new Vector3(0, 0.023, 0);
const combToothTip = new Vector3(-0.014, 0.179, -0.074);
const combToothLength = 0.036;
const fingerNames = ["index", "middle", "ring", "pinky", "thumb"];
const restCurls = [0.06, 0.08, 0.1, 0.12, 0.035];
// Local joint angles in degrees, from the knuckle to the tip, fitted to the tennis ball.
const ballGripAngles = [
  [[-11.5, 9, -19], [0, 0, -28.5], [0, 0, -13.3]], // Index
  [[-31.5, -16.2, -6.9], [0, 0, -50], [0, 0, -7.9]], // Middle
  [[-29, -4.6, -11.3], [0, 0, -46.1], [0, 0, 3.2]], // Ring
  [[-30, 16.6, -29.3], [0, 0, -15.7], [0, 0, 0.1]], // Little
  [[-2.3, -17.3, 1.1], [7.9, -4.7, -6.9], [0, 0, -12.8]], // Thumb
];
type HandPose = "head" | "chin" | "back" | "side" | "fingertips" | "brush" | "point";
const handPose: Record<HandGesture, HandPose> = {
  head: "head", ear: "fingertips", cheek: "fingertips", chin: "chin",
  chest: "side", back: "back", flank: "side", leg: "side", paw: "fingertips",
  tailRoot: "fingertips", tail: "fingertips", belly: "side", rear: "point", brush: "brush",
};
const thumbCurls: Record<HandPose, number> = { head: 0.105, chin: 0.22, back: 0.105, side: 0.12, fingertips: 0.22, brush: 0.3, point: 0.36 };
const palmContact: Record<HandPose, number> = { head: 0.3, chin: 0, back: 0.82, side: 0.76, fingertips: 0, brush: 0, point: 0 };
const contactGrace = 0.11;
const touchContactGrace = 0.18;
const reachTime = 0.15;
const retractTime = 0.23;
const gestureDelay = 0.065;
const followSpeed = 5.6;
const wristSpeed = 11;

function handMaterials(group: Group, comb: Group) {
  const skin = new Set<Material>();
  const tool = new Set<Material>();
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const slots = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of slots) {
      material.transparent = true;
      material.needsUpdate = true;
      (object.parent === comb ? tool : skin).add(material);
    }
  });
  return { skin, tool };
}

function fingerCurl(gesture: HandPose, finger: number, phase: number, stroke: number) {
  if (finger === 4) return thumbCurls[gesture];
  switch (gesture) {
    case "chin":
      return finger < 2 ? 0.23 + 0.19 * Math.sin(phase + finger * 2.45) : 0.47 + finger * 0.034;
    case "back":
    case "side":
      return 0.10 + finger * 0.022 + 0.036 * stroke;
    case "fingertips":
      return finger < 2 ? 0.16 + finger * 0.04 + 0.05 * stroke : 0.46 + finger * 0.04;
    case "point":
      return finger === 0 ? 0.028 : 0.67 + finger * 0.034;
    case "brush":
      return 0.36 + finger * 0.035;
    case "head":
      return 0.112 + finger * 0.023 + (0.062 - finger * 0.008) * stroke;
  }
}

export function PlayerHand({ contact, ball }: { contact: RefObject<HandContact | null>; ball: RefObject<BallState> }) {
  const { scene } = useLoader(GLTFLoader, playerHandUrl);
  const hand = useRef<Group>(null);
  const comb = useRef<Group>(null);
  const rig = useMemo(() => {
    const tip = scene.getObjectByName("player_hand_tip");
    const index = scene.getObjectByName("index_03_r");
    if (!tip || !index) throw new Error("Player hand fingertip missing");
    const fingers: { bone: Bone; rest: Quaternion; finger: number; bend: number; grip: Quaternion }[] = [];
    scene.traverse((child) => {
      if (!(child instanceof Bone)) return;
      const match = /^(index|middle|ring|pinky|thumb)_0([123])_r$/.exec(child.name);
      if (!match) return;
      const finger = fingerNames.indexOf(match[1]);
      const joint = Number(match[2]);
      const bend = finger === 4 ? (joint === 1 ? 1 : 0.5) : (joint === 3 ? 0.5 : 1);
      const [x, y, z] = ballGripAngles[finger][joint - 1].map(MathUtils.degToRad);
      const grip = new Quaternion().setFromEuler(new Euler(x, y, z));
      fingers.push({ bone: child, rest: child.quaternion.clone(), finger, bend, grip });
    });
    const bendFingers = (curls: number[], offset: Quaternion, gripping: number) => {
      for (const { bone, rest, finger, bend, grip } of fingers) {
        offset.setFromAxisAngle(bendAxis, -curls[finger] * bend);
        if (gripping > 0) offset.slerp(grip, gripping);
        bone.quaternion.copy(rest).multiply(offset);
      }
    };
    return { tip, index, bendFingers };
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
    tipMix: 0,
    combMix: 0,
    inputMotion: new Vector2(),
    drag: new Vector2(),
    dragged: false,
    gesture: "head" as HandGesture,
    candidate: "head" as HandGesture,
    candidateFor: 0,
    lastContact: null as HandContact | null,
    missedFor: contactGrace,
    reach: 0,
    onBall: false,
    ballGrip: 0,
    clearance: 0,
    materials: null as ReturnType<typeof handMaterials> | null,
    separate: null as ReturnType<typeof createHandClearance> | null,
  }), []);

  useFrame(({ camera, size }, delta) => {
    const group = hand.current;
    const toolModel = comb.current;
    if (!group || !toolModel) return;
    let target = contact.current;
    const { brushEquipped, panel, foodOpen } = useGameUI.getState();
    const step = Math.min(delta, 0.05);
    const disabled = panel || foodOpen;
    if (disabled || (target && (performance.now() >= target.visibleUntil || (!brushEquipped && target.gesture === "brush")))) {
      contact.current = null;
      target = null;
      pose.missedFor = touchContactGrace;
    }

    const appearing = pose.reach === 0;
    const blend = 1 - Math.exp(-step * 24);
    const { mesh: toy, hovered, motion } = ball.current;
    const holdingBall = motion.phase === "held";
    const puttingBack = motion.phase === "putBack";
    const toss = motion.phase === "flight" && motion.play && motion.elapsed < 0.26 ? motion : null;
    const gripTime = holdingBall ? motion.elapsed : toss && toss.elapsed < 0 ? toss.elapsed + ballGripCloseTime : null;
    const ballPoint = disabled || (!holdingBall && !puttingBack && !toss && !hovered) ? null : toss?.from ?? toy?.position;
    if (ballPoint || (pose.onBall && !target && !appearing)) {
      if (!pose.onBall) {
        pose.lastContact = null;
        pose.startedAt = null;
        pose.clearance = 0;
        pose.pressure = 0;
      }
      pose.onBall = true;
      if (ballPoint) {
        pose.point.lerp(ballPoint, appearing || holdingBall || puttingBack || toss ? 1 : blend);
        pose.missedFor = 0;
      } else {
        pose.missedFor += step;
      }
      pose.reach = MathUtils.clamp(pose.reach + (ballPoint ? step / reachTime : -step / retractTime), 0, 1);
      group.visible = pose.reach > 0;
      pose.combMix = MathUtils.lerp(pose.combMix, 0, blend);
      toolModel.visible = group.visible && pose.combMix > 0.02;
      if (!group.visible) return;

      const followThrough = toss ? MathUtils.smoothstep(toss.elapsed, 0, 0.20) : 0;
      pose.view.subVectors(camera.position, pose.point).normalize();
      // Bring the wrist in diagonally from the player's right.
      pose.x.set(1, 0, 0).applyQuaternion(camera.quaternion);
      pose.z.copy(pose.x).multiplyScalar(0.42).addScaledVector(worldUp, 0.68).addScaledVector(pose.view, -0.6).normalize();
      pose.y.copy(pose.x).multiplyScalar(-0.76).addScaledVector(worldUp, -0.64).addScaledVector(pose.view, -0.31);
      pose.y.addScaledVector(pose.z, -pose.y.dot(pose.z)).normalize();
      pose.x.crossVectors(pose.y, pose.z);
      pose.rotation.setFromRotationMatrix(pose.basis.makeBasis(pose.x, pose.y, pose.z));
      pose.rotation.multiply(pose.offset.setFromAxisAngle(pitchAxis, -0.49 * followThrough));
      group.quaternion.slerp(pose.rotation, appearing ? 1 : blend);
      pose.ballGrip = ballPoint && gripTime !== null
        ? MathUtils.smoothstep(gripTime, 0.015, ballGripCloseTime)
        : MathUtils.damp(pose.ballGrip, 0, toss ? 33 : 24, step);
      if (puttingBack && ballPoint) {
        pose.ballGrip = 1 - MathUtils.smoothstep(motion.elapsed, ballPutBackTime * 0.64, ballPutBackTime);
      }
      for (let finger = 0; finger < pose.curl.length; finger++) {
        const open = restCurls[finger] + 0.07 * (1 - followThrough);
        pose.curl[finger] = MathUtils.lerp(pose.curl[finger], open, appearing ? 1 : blend);
      }
      rig.bendFingers(pose.curl, pose.offset, pose.ballGrip);

      const retreat = ballPoint ? 0 : 0.36 * (1 - pose.reach);
      pose.z.set(0, 0, 1).applyQuaternion(group.quaternion);
      pose.goal.copy(pose.point).addScaledVector(pose.z, 0.155 * (1 - pose.ballGrip) + retreat);
      if (toss) {
        const release = Math.max(0, toss.elapsed);
        pose.goal.addScaledVector(toss.direction, 0.27 * followThrough);
        pose.goal.addScaledVector(pose.z, 0.08 * (1 - pose.ballGrip));
        pose.goal.y += 0.52 * (1 - Math.exp(-release * 15));
      }
      pose.palmPad.copy(ballGripCenter).multiplyScalar(group.scale.x).applyQuaternion(group.quaternion);
      group.position.copy(pose.goal).sub(pose.palmPad);

      pose.materials ??= handMaterials(group, toolModel);
      const opacity = MathUtils.smoothstep(pose.reach, 0, 0.72);
      for (const material of pose.materials.skin) material.opacity = opacity;
      for (const material of pose.materials.tool) material.opacity = opacity * pose.combMix;
      return;
    }
    pose.onBall = false;
    if (appearing && !target) return;
    pose.repickIn = Math.max(0, pose.repickIn - step);
    if (target) {
      target.dog.updateMatrixWorld(true);
      samplePetSurface(target, pose.triangle, pose.hitPoint, pose.hitNormal);
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
            const part = hitPetTarget(hit)?.part;
            const brushingStroke = previous.pressed && previous.gesture === "brush";
            if (part && (!brushingStroke || part === "back")) {
              previous.vertices = [hit.face.a, hit.face.b, hit.face.c];
              previous.weights = hit.barycoord;
              previous.gesture = brushEquipped && part === "back" && (!previous.pressed || brushingStroke) ? "brush" : part;
              samplePetSurface(previous, pose.triangle, pose.hitPoint, pose.hitNormal);
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
    const grace = pose.lastContact?.touch && pose.lastContact.pressed ? touchContactGrace : contactGrace;
    const reaching = pose.missedFor < grace;
    pose.reach = MathUtils.clamp(pose.reach + (reaching ? step / reachTime : -step / retractTime), 0, 1);
    if (pose.reach === 0 || !pose.lastContact) {
      pose.lastContact = null;
      toolModel.visible = false;
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
      pose.tipMix = 0;
    }
    pose.pressure = MathUtils.damp(pose.pressure, Number(active), active ? 19 : 13, step);
    const gesture = handPose[pose.gesture];
    const chin = gesture === "chin";
    const fingertips = gesture === "fingertips";
    const pettingSide = gesture === "side";
    const rubbingBelly = pose.gesture === "belly";
    const pointing = gesture === "point";
    const brushing = gesture === "brush";
    const alongBack = gesture === "back" || brushing;
    pose.combMix = MathUtils.lerp(pose.combMix, Number(brushing), appearing ? 1 : blend);
    toolModel.visible = pose.combMix > 0.02;
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
    if (pointing) {
      // Point the index straight along the wrist's approach to the surface.
      pose.y.copy(pose.normal).negate().addScaledVector(pose.view, -0.34).addScaledVector(worldUp, -0.17).normalize();
      pose.z.copy(worldUp).addScaledVector(pose.y, -pose.y.y).normalize();
    } else {
      if (pettingSide || fingertips) {
        pose.z.copy(pose.normal).multiplyScalar(1.35).addScaledVector(pose.view, 0.38).addScaledVector(worldUp, 0.22).normalize();
      } else {
        pose.z.copy(pose.normal).multiplyScalar(alongBack ? 1.15 : chin ? 0.58 : 0.58 + 0.26 * pose.pressure);
        pose.z.addScaledVector(pose.view, alongBack ? 0.28 : 0.62);
        pose.z.addScaledVector(worldUp, chin ? -1.1 : alongBack ? 0.34 : 0.35 + 0.75 * highTouch).normalize();
      }

      if (brushing) {
        // Point the teeth across the coat, with the grip following the stroke.
        pose.y.copy(pose.forward).negate().addScaledVector(pose.view, -0.43);
      } else if (pettingBack) {
        pose.y.copy(pose.view).negate().addScaledVector(pose.forward, 0.60);
      } else if (rubbingBelly) {
        pose.y.copy(pose.forward).addScaledVector(worldUp, 0.18);
      } else if (pettingSide || fingertips) {
        // A high wrist keeps the fingers clear of the muzzle and the low part of the room.
        pose.y.copy(worldUp).negate().addScaledVector(pose.forward, -0.48).addScaledVector(pose.view, -0.27);
      } else {
        pose.y.copy(pose.forward).negate().addScaledVector(pose.view, -0.48);
        // Keep the cuff clear of the face when the dog looks straight at the camera.
        const frontal = MathUtils.smoothstep(pose.forward.dot(pose.view), 0.84, 0.98);
        pose.x.set(1, 0, 0).applyQuaternion(camera.quaternion);
        pose.y.addScaledVector(pose.x, frontal * (chin ? 0.85 : 1.55));
        pose.y.addScaledVector(worldUp, chin ? 0.24 * highTouch : 0.26 * highTouch - 1.55 * frontal);
      }
    }
    pose.y.addScaledVector(pose.z, -pose.y.dot(pose.z)).normalize();
    pose.x.crossVectors(pose.y, pose.z);
    pose.rotation.setFromRotationMatrix(pose.basis.makeBasis(pose.x, pose.y, pose.z));
    pose.strokeDirection.set(pose.drag.x, pose.drag.y, 0).applyQuaternion(camera.quaternion);
    const restingPitch = chin || brushing ? -0.42 : -0.59;
    const touchingPitch = chin ? -0.35 : brushing ? -0.1 : alongBack || pettingSide || fingertips ? -0.04 : MathUtils.lerp(-0.47, -0.31, crown);
    const wristMotion = (chin ? 0.045 * scratch : -0.068 * stroke) * pose.pressure;
    const pitch = pointing ? 0 : MathUtils.lerp(restingPitch, touchingPitch, pose.pressure) + wristMotion - 0.064 * pose.strokeDirection.dot(pose.y);
    const roll = pointing ? 0.13 : (chin ? 0.022 * scratch : 0.055 * pulse) * pose.pressure - 0.16 * pose.strokeDirection.dot(pose.x);
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
      const turn = Math.min(1 - Math.exp(-step * (pointing ? 24 : 17)), step * (pointing ? 16 : wristSpeed) / Math.max(angle, 0.001));
      group.quaternion.slerp(pose.rotation, turn);
    }

    const grip = pointing ? 1 : Math.max(pose.pressure, pose.combMix);
    for (let finger = 0; finger < pose.curl.length; finger++) {
      const curl = MathUtils.lerp(restCurls[finger], fingerCurl(gesture, finger, phase, stroke), grip);
      pose.curl[finger] = MathUtils.lerp(pose.curl[finger], curl, appearing ? 1 : blend);
    }
    pose.ballGrip = appearing ? 0 : MathUtils.damp(pose.ballGrip, 0, 24, step);
    rig.bendFingers(pose.curl, pose.offset, pose.ballGrip);
    rig.tip.getWorldPosition(pose.fingertip);
    const tipWeight = chin ? 0.32 + 0.18 * Math.sin(phase + 0.45) : pointing ? 1 : fingertips ? 0.8 : 0;
    pose.tipMix = MathUtils.lerp(pose.tipMix, tipWeight, appearing ? 1 : blend);
    if (pose.tipMix > 0.001) {
      rig.index.localToWorld(pose.indexPad.copy(indexPad));
      pose.fingertip.lerp(pose.indexPad, pose.tipMix);
    }
    pose.z.set(0, 0, 1).applyQuaternion(group.quaternion);
    const aligned = MathUtils.smoothstep(pose.normal.dot(pose.z), 0.45, 0.84);
    // Lead with the finger pads along the cheeks and let the palm settle on flatter fur.
    const palmWeight = rubbingBelly ? 0.72 : gesture === "head" ? palmContact.head * MathUtils.lerp(0.25, 1, crown)
      : pettingSide ? palmContact.side * MathUtils.smoothstep(pose.point.y, 0.10, 0.37) : palmContact[gesture];
    pose.palmMix = MathUtils.lerp(pose.palmMix, palmWeight * pose.pressure * aligned, blend);
    pose.palmPad.copy(palmPad).applyMatrix4(group.matrixWorld);
    pose.fingertip.lerp(pose.palmPad, pose.palmMix);
    if (toolModel.visible) {
      pose.palmPad.copy(combToothTip).applyMatrix4(group.matrixWorld);
      pose.fingertip.lerp(pose.palmPad, pose.combMix);
    }

    pose.nextOutward.copy(pose.normal).multiplyScalar(0.8).addScaledVector(pose.z, pointing ? 0 : 0.85).addScaledVector(pose.view, pointing ? 0.45 : 0.18);
    const nearRug = pose.point.y < 0.52;
    if (nearRug) pose.nextOutward.y = Math.max(0.42, pose.nextOutward.y);
    pose.outward.lerp(pose.nextOutward.normalize(), appearing ? 1 : blend).normalize();
    if (nearRug && pose.outward.y < 0.25) {
      pose.outward.y = 0.25;
      pose.outward.normalize();
    }
    pose.goal.copy(pose.point);
    if (gesture === "head" || gesture === "back" || pettingSide || fingertips) {
      pose.strokeDirection.copy(pose.forward).addScaledVector(pose.normal, -pose.forward.dot(pose.normal));
      pose.goal.addScaledVector(pose.strokeDirection, -(fingertips ? 0.018 : gesture === "back" ? 0.068 : 0.035) * pulse * pose.pressure);
    }
    const retreat = 0.42 * (1 - MathUtils.smoothstep(pose.reach, 0, 1));
    const pointPulse = Math.sin(Math.PI * MathUtils.smoothstep(pose.elapsed, 0.045, 0.39));
    pose.goal.addScaledVector(pose.outward, pointing ? MathUtils.lerp(0.122, 0.006, pointPulse) : MathUtils.lerp(0.052, 0.008, pose.pressure));
    pose.goal.addScaledVector(pose.view, retreat);
    group.position.add(pose.goal.sub(pose.fingertip));
    group.updateMatrixWorld(true);
    if (!target) last.dog.updateMatrixWorld(true);
    pose.separate ??= createHandClearance(group, toolModel);
    pose.x.set(1, 0, 0).applyQuaternion(group.quaternion);
    const shift = pose.separate(last.mesh, pose.outward, pose.x);
    pose.clearance = Math.max(shift, MathUtils.damp(pose.clearance, shift, 21, step));
    group.position.addScaledVector(pose.outward, pose.clearance);

    pose.materials ??= handMaterials(group, toolModel);
    const opacity = MathUtils.smoothstep(pose.reach, 0, 0.72);
    for (const material of pose.materials.skin) material.opacity = opacity;
    for (const material of pose.materials.tool) material.opacity = opacity * pose.combMix;
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
      <group name="Grooming comb" ref={comb} visible={false}>
        <mesh position={[-0.014, 0.126, -0.028]} scale={[1, 1, 0.86]}>
          <cylinderGeometry args={[0.014, 0.019, 0.088, 12]} />
          <meshStandardMaterial color="#385850" roughness={0.77} />
        </mesh>
        <mesh position={[combToothTip.x, combToothTip.y, -0.03]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.013, 0.116, 3, 12]} />
          <meshStandardMaterial color="#a9764e" roughness={0.64} />
        </mesh>
        {Array.from({ length: 9 }, (_, index) => (
          <mesh key={index} position={[combToothTip.x + (index - 4) * 0.014, combToothTip.y, combToothTip.z + combToothLength / 2]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.0029, 0.004, combToothLength, 8]} />
            <meshStandardMaterial color="#d7d4c8" metalness={0.28} roughness={0.42} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
