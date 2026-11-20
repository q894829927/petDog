import { Suspense, useCallback, useEffect, useRef, type PointerEvent, type RefObject } from "react";
import { Canvas, events, useThree, type RootStore } from "@react-three/fiber";
import { SkinnedMesh, Vector3, type Group, type PerspectiveCamera } from "three";
import { useGameUI } from "../store/useGameUI";
import { AkitaDog } from "./AkitaDog";
import { LivingRoom } from "./LivingRoom";
import { PlayerHand, type HandContact } from "./PlayerHand";
import { cancelBallGrab, TennisBall, type BallState } from "./TennisBall";
import { createNearbyTouchPicker } from "./petTouch";
import { ballStart } from "./roomNavigation";

const roomFov = 37;
function roomEvents(store: RootStore, ball: RefObject<BallState>, dog: RefObject<Group | null>) {
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
      if (motion.phase === "held") return hits.filter(({ object }) => object === toy);
      if (motion.phase !== "rest") hits = hits.filter(({ object }) => object !== toy);
      const { panel, foodOpen } = useGameUI.getState();
      const event = pointerEvent;
      if (!event?.isPrimary || panel || foodOpen ||
          (event.type !== "pointerdown" && event.type !== "pointermove") ||
          hits.some(({ object }) => object instanceof SkinnedMesh || object === toy)) return hits;

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

      if (event.pointerType !== "touch" || (event.type === "pointermove" && (event.buttons & 1) === 0)) return hits;
      const mesh = dog.current?.getObjectByProperty("isSkinnedMesh", true);
      if (!(mesh instanceof SkinnedMesh)) return hits;
      const nearby = pickNearby(mesh, camera, pointer, size.width, size.height);
      return nearby ? [nearby, ...hits] : hits;
    },
  };
  return manager;
}

function StageCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    const portrait = size.width < 640 && size.width < size.height;
    const distance = Math.max(7.45, (portrait ? 5.45 : 5.3) * size.height / size.width);
    perspective.position.set(0.12, portrait ? 2.65 : 2.48, distance + 0.42);
    perspective.lookAt(0.12, 1.04, 0.68);
    perspective.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export function PetWorld() {
  const highQuality = useGameUI((state) => state.quality === "high");
  const dog = useRef<Group>(null);
  const ball = useRef<BallState>({ mesh: null, hovered: false, motion: { phase: "rest" } });
  const handContact = useRef<HandContact | null>(null);
  const sceneEvents = useCallback((store: RootStore) => roomEvents(store, ball, dog), []);
  const releaseHand = (event: PointerEvent<HTMLDivElement>) => {
    cancelBallGrab(ball.current, event.pointerId);
    const target = handContact.current;
    if (target?.pointer !== event.pointerId) return;
    target.pressed = false;
    if (target.visibleUntil === Infinity && event.pointerType !== "mouse") {
      target.visibleUntil = performance.now() + 320;
    }
  };
  const cancelHand = (event: PointerEvent<HTMLDivElement>) => {
    cancelBallGrab(ball.current, event.pointerId);
    if (handContact.current?.pointer === event.pointerId) handContact.current = null;
  };
  return (
    <div
      className="world-canvas"
      aria-label="秋田犬的 3D 宠物房间"
      onPointerUp={releaseHand}
      onPointerCancel={cancelHand}
      onLostPointerCapture={(event) => cancelBallGrab(ball.current, event.pointerId)}
    >
      <Canvas
        events={sceneEvents}
        shadows={highQuality}
        dpr={highQuality ? [1, 1.75] : [1, 1.1]}
        camera={{ fov: roomFov, position: [0, 2.35, 7.2], near: 0.1, far: 50 }}
        gl={{ antialias: highQuality, powerPreference: "high-performance" }}
        fallback={<div className="webgl-fallback">当前设备无法加载 3D 场景，请尝试其他浏览器。</div>}
      >
        <StageCamera />
        <LivingRoom shadows={highQuality} />
        <TennisBall ball={ball} dog={dog} />
        <Suspense fallback={null}>
          <AkitaDog ball={ball} dog={dog} handContact={handContact} />
          <PlayerHand contact={handContact} ball={ball} />
        </Suspense>
      </Canvas>
    </div>
  );
}
