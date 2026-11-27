import { Suspense, useCallback, useEffect, useRef, type PointerEvent, type RefObject } from "react";
import { Canvas, events, useFrame, useThree, type RootStore } from "@react-three/fiber";
import { MathUtils, SkinnedMesh, Vector3, type Group, type PerspectiveCamera } from "three";
import { useGameUI } from "../store/useGameUI";
import { AkitaDog } from "./AkitaDog";
import { GroundContactShadows, type DogShadowAnchors } from "./GroundContactShadows";
import { LivingRoom } from "./LivingRoom";
import { PlayerHand, type HandContact } from "./PlayerHand";
import { ballFloorPoint, cancelBallGrab, TennisBall, type BallState } from "./TennisBall";
import { createNearbyTouchPicker } from "./petTouch";
import { ballStart, dogHome } from "./roomNavigation";
import { createHighFiveState, highFiveSide, type HighFiveState } from "./highFive";

const roomFov = 37;
function roomEvents(store: RootStore, ball: RefObject<BallState>, dog: RefObject<Group | null>, highFive: HighFiveState) {
  const base = events(store);
  const pickNearby = createNearbyTouchPicker();
  const ballCenter = new Vector3();
  const ballEdge = new Vector3();
  let pointerEvent: globalThis.PointerEvent | null = null;
  const manager: ReturnType<typeof events> = {
    ...base,
    compute(event, state) {
      base.compute?.(event, state);
      pointerEvent = "pointerType" in event ? event : null;
    },
    filter(hits, { camera, pointer, size }) {
      const { mesh: toy, motion } = ball.current;
      if (motion.phase === "held") {
        highFive.pointer = null;
        return hits.filter(({ object }) => object === toy);
      }
      if (motion.phase !== "rest") hits = hits.filter(({ object }) => object !== toy);
      const { panel, foodOpen, brushEquipped } = useGameUI.getState();
      const event = pointerEvent;
      if (!event?.isPrimary) {
        if (event?.pointerType === "touch" && event.type === "pointerdown") highFive.pointer = null;
        return hits;
      }
      if (event.type !== "pointerdown" && event.type !== "pointermove") return hits;
      const prior = highFive.pointer;
      const touch = event.pointerType === "touch";
      const offering = !panel && !foodOpen && !brushEquipped && (touch ? event.buttons === 1 &&
        (event.type === "pointerdown" || prior?.id === event.pointerId) : event.pointerType === "mouse" && event.buttons === 0);
      highFive.pointer = null;
      const inReach = offering && highFiveSide(highFive, pointer, size) !== null;
      // A raised paw can enter the same ray as the hand that was already waiting in the air.
      if (inReach && highFive.offered && prior?.id === event.pointerId && event.type === "pointermove") {
        hits = hits.filter(({ object }) => !(object instanceof SkinnedMesh));
      }
      if (panel || foodOpen || hits.some(({ object }) => object instanceof SkinnedMesh || object === toy)) return hits;

      if (toy && motion.phase === "rest" && (event.type === "pointerdown" || event.buttons === 0)) {
        // Leave a small margin around the visible ball without overriding a direct hit on the dog.
        ballCenter.copy(toy.position).project(camera);
        ballEdge.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(ballStart.radius).add(toy.position).project(camera);
        const radius = Math.abs(ballEdge.x - ballCenter.x) * size.width / 2;
        const distance = Math.hypot((pointer.x - ballCenter.x) * size.width / 2, (pointer.y - ballCenter.y) * size.height / 2);
        if (distance <= radius + (event.pointerType === "touch" ? 12 : 8)) {
          return [{ object: toy, point: toy.position.clone(), distance: camera.position.distanceTo(toy.position) }, ...hits];
        }
      }

      if (inReach) {
        highFive.pointer = prior?.id === event.pointerId ? prior : { id: event.pointerId, touch, ndc: pointer.clone() };
        highFive.pointer.ndc.copy(pointer);
        return hits;
      }
      if (!touch || (event.type === "pointermove" && (event.buttons & 1) === 0)) return hits;
      const mesh = dog.current?.getObjectByProperty("isSkinnedMesh", true);
      if (!(mesh instanceof SkinnedMesh)) return hits;
      const nearby = pickNearby(mesh, camera, pointer, size.width, size.height);
      return nearby ? [nearby, ...hits] : hits;
    },
  };
  return manager;
}

function StageCamera({ ball, dog, contact, highFive }: {
  ball: RefObject<BallState>;
  dog: RefObject<Group | null>;
  contact: RefObject<HandContact | null>;
  highFive: HighFiveState;
}) {
  const { camera, size } = useThree();
  const portrait = size.width < 640 && size.width < size.height;
  const aspect = size.width / size.height;
  const distance = Math.max(7.45, (portrait ? 5.45 : 5.3) / aspect);
  const eyeHeight = portrait ? 2.65 : 2.48;
  const focus = useRef(new Vector3(0.12, 1.04, 0.68));
  const wideShot = useRef(false);

  useEffect(() => {
    focus.current.set(0.12, 1.04, 0.68);
    camera.position.set(0.12, eyeHeight, distance + 0.42);
    camera.lookAt(focus.current);
    (camera as PerspectiveCamera).updateProjectionMatrix();
    camera.updateMatrixWorld();
  }, [camera, distance, eyeHeight]);

  useFrame((_, delta) => {
    const sceneBall = ball.current;
    const { motion } = sceneBall;
    if (motion.phase === "held" || motion.phase === "putBack" || contact.current?.pressed || highFive.offered) return;

    const pet = dog.current?.position ?? dogHome;
    const offsetX = pet.x - 0.12;
    let x = 0.12 + Math.sign(offsetX) * Math.max(0, Math.abs(offsetX) - (portrait ? 0.45 : 1.05));
    let depth = MathUtils.clamp((pet.z + 1.55) * 0.56, -1.95, 0);
    let height = eyeHeight;
    let eyeZ = distance + 0.42 + depth;
    let lookY = 1.04;

    const target = motion.phase === "flight" ? motion.prediction.farthest : ballFloorPoint(sceneBall);
    const far = target.z < -2.15 || Math.abs(target.x - pet.x) > (portrait ? 2.05 : 3.25);
    if (motion.phase === "flight" && motion.play) {
      wideShot.current = far;
    } else if (motion.phase === "rest" && !far) {
      wideShot.current = false;
    }
    if (wideShot.current) {
      x = (pet.x + target.x) / 2;
      depth = MathUtils.clamp(Math.min(pet.z, target.z) * 0.36, -1.66, 0);
      height += 1.22;
      lookY = 1.22;
      const halfWidth = Math.abs(pet.x - target.x) / 2 + 1.46;
      const widthPerDepth = Math.tan(MathUtils.degToRad(roomFov / 2)) * aspect;
      eyeZ = Math.max(distance + 2.65 + depth, Math.max(pet.z, target.z) + halfWidth / widthPerDepth);
    }

    const step = Math.min(delta, 0.05);
    const ease = 3.8;
    const position = camera.position;
    const aim = focus.current;
    position.set(MathUtils.damp(position.x, x, ease, step), MathUtils.damp(position.y, height, ease, step),
      MathUtils.damp(position.z, eyeZ, ease, step));
    aim.set(position.x, MathUtils.damp(aim.y, lookY, ease, step), MathUtils.damp(aim.z, 0.68 + depth, ease, step));
    camera.lookAt(aim);
    camera.updateMatrixWorld();
  }, -2);
  return null;
}

export function PetWorld() {
  const highQuality = useGameUI((state) => state.quality === "high");
  const dog = useRef<Group>(null);
  const dogAnchors = useRef<DogShadowAnchors | null>(null);
  const ball = useRef<BallState>({ mesh: null, hovered: false, motion: { phase: "rest" } });
  const handContact = useRef<HandContact | null>(null);
  const highFive = useRef(createHighFiveState());
  const sceneEvents = useCallback((store: RootStore) => roomEvents(store, ball, dog, highFive.current), []);
  useEffect(() => {
    const clearPointer = () => { highFive.current.pointer = null; };
    window.addEventListener("blur", clearPointer);
    document.addEventListener("visibilitychange", clearPointer);
    return () => {
      window.removeEventListener("blur", clearPointer);
      document.removeEventListener("visibilitychange", clearPointer);
    };
  }, []);
  const clearHighFive = (event: PointerEvent<HTMLDivElement>) => {
    if (highFive.current.pointer?.id === event.pointerId) highFive.current.pointer = null;
  };
  const releaseHand = (event: PointerEvent<HTMLDivElement>) => {
    clearHighFive(event);
    cancelBallGrab(ball.current, event.pointerId);
    const target = handContact.current;
    if (target?.pointer !== event.pointerId) return;
    target.pressed = false;
    if (target.visibleUntil === Infinity && event.pointerType !== "mouse") {
      target.visibleUntil = performance.now() + 320;
    }
  };
  const cancelHand = (event: PointerEvent<HTMLDivElement>) => {
    clearHighFive(event);
    cancelBallGrab(ball.current, event.pointerId);
    if (handContact.current?.pointer === event.pointerId) handContact.current = null;
  };
  return (
    <div
      className="world-canvas"
      aria-label="秋田犬的 3D 宠物房间"
      onPointerUp={releaseHand}
      onPointerCancel={cancelHand}
      onPointerLeave={clearHighFive}
      onLostPointerCapture={(event) => {
        clearHighFive(event);
        cancelBallGrab(ball.current, event.pointerId);
      }}
    >
      <Canvas
        events={sceneEvents}
        shadows={highQuality}
        dpr={highQuality ? [1, 1.75] : [1, 1.1]}
        camera={{ fov: roomFov, position: [0, 2.35, 7.2], near: 0.1, far: 50 }}
        gl={{ antialias: highQuality, powerPreference: "high-performance" }}
        fallback={<div className="webgl-fallback">当前设备无法加载 3D 场景，请尝试其他浏览器。</div>}
      >
        <StageCamera ball={ball} dog={dog} contact={handContact} highFive={highFive.current} />
        <Suspense fallback={null}>
          <LivingRoom shadows={highQuality} />
          <GroundContactShadows ball={ball} dog={dog} dogAnchors={dogAnchors} />
        </Suspense>
        <TennisBall ball={ball} dog={dog} />
        <AkitaDog ball={ball} dog={dog} dogAnchors={dogAnchors} handContact={handContact} highFive={highFive} />
        <Suspense fallback={null}>
          <PlayerHand contact={handContact} ball={ball} highFive={highFive} />
        </Suspense>
      </Canvas>
    </div>
  );
}
