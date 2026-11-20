import { useEffect, useMemo, type RefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { MathUtils, Plane, Raycaster, Vector2, Vector3, type Group, type Mesh } from "three";
import { useCloudPet } from "../cloud/useCloudPet";
import { useGameUI } from "../store/useGameUI";
import { ballGroundY, ballStart, chooseBallLanding, roomBounds, type FloorPoint } from "./roomNavigation";

type BallGrab = {
  phase: "held";
  pointer: number;
  origin: Vector3;
  goal: Vector3;
  plane: Plane;
  offset: Vector2;
  downX: number;
  downY: number;
  elapsed: number;
};

type BallFlight = {
  phase: "flight";
  from: Vector3;
  to: Vector3;
  lift: number;
  duration: number;
  elapsed: number;
  play: { sequence: number; owner: number | null } | null;
};

export type BallState = {
  mesh: Mesh | null;
  hovered: boolean;
  motion: { phase: "rest" } | { phase: "fetch"; owner: number | null } | BallGrab | BallFlight;
};

export const ballGripCloseTime = 0.14;

export function ballFloorPoint({ mesh, motion }: BallState): FloorPoint {
  if (motion.phase === "held") return motion.origin;
  if (motion.phase === "flight") return motion.to;
  return mesh?.position ?? ballStart;
}

export function cancelBallGrab(ball: BallState, pointer: number) {
  const { mesh, motion } = ball;
  if (!mesh || motion.phase !== "held" || motion.pointer !== pointer) return;
  ball.motion = {
    phase: "flight", from: mesh.position.clone(), to: motion.origin,
    duration: 0.23, lift: 0, elapsed: 0, play: null,
  };
}

export function TennisBall({ ball, dog }: {
  ball: RefObject<BallState>;
  dog: RefObject<Group | null>;
}) {
  const { gl, camera, size } = useThree();
  const { ray, pointer, liftGoal } = useMemo(() => ({
    ray: new Raycaster(), pointer: new Vector2(), liftGoal: new Vector3(),
  }), []);

  useEffect(() => () => { gl.domElement.style.cursor = ""; }, [gl]);

  useFrame((_, delta) => {
    const state = ball.current;
    const toy = state.mesh;
    if (!toy) return;
    const ui = useGameUI.getState();
    if (ui.panel || ui.foodOpen) {
      state.hovered = false;
      if (state.motion.phase === "held") cancelBallGrab(state, state.motion.pointer);
    }
    const motion = state.motion;
    const cursor = motion.phase === "held" ? "grabbing" : motion.phase === "rest" && state.hovered ? "grab" : "";
    if (gl.domElement.style.cursor !== cursor) gl.domElement.style.cursor = cursor;

    const step = Math.min(delta, 0.05);
    if (motion.phase === "held") {
      motion.elapsed += step;
      const lift = MathUtils.smoothstep(motion.elapsed, ballGripCloseTime, ballGripCloseTime + 0.12);
      liftGoal.lerpVectors(motion.origin, motion.goal, lift);
      toy.position.lerp(liftGoal, 1 - Math.exp(-step * 26));
    } else if (motion.phase === "flight") {
      motion.elapsed += step;
      const t = MathUtils.clamp(motion.elapsed / motion.duration, 0, 1);
      toy.position.lerpVectors(motion.from, motion.to, MathUtils.smootherstep(t, 0, 1));
      toy.position.y = MathUtils.lerp(motion.from.y, motion.to.y, t) + motion.lift * 4 * t * (1 - t);
      if (motion.lift > 0 && t > 0) toy.rotation.x += step * 8;
      if (t === 1) {
        if (motion.play?.sequence === (ui.interaction?.sequence ?? 0)) {
          state.motion = { phase: "fetch", owner: motion.play.owner };
          ui.trigger("ball");
        } else {
          state.motion = { phase: "rest" };
        }
      }
    }
  }, -1);

  const moveHeldBall = (event: ThreeEvent<PointerEvent>, grab: BallGrab) => {
    ray.setFromCamera(pointer.copy(event.pointer).add(grab.offset), camera);
    ray.ray.intersectPlane(grab.plane, grab.goal);
    grab.goal.y = MathUtils.clamp(grab.goal.y + 0.23, 0.45, 2.8);
  };

  const pointerDown = (event: ThreeEvent<PointerEvent>) => {
    const state = ball.current;
    const { panel, foodOpen } = useGameUI.getState();
    if (!event.isPrimary || event.button !== 0 || panel || foodOpen || state.motion.phase !== "rest" || !dog.current) return;
    event.stopPropagation();
    const toy = event.object as Mesh;
    const center = toy.position.clone().project(camera);
    const grab: BallGrab = {
      phase: "held",
      pointer: event.pointerId,
      origin: toy.position.clone(),
      goal: toy.position.clone(),
      plane: new Plane(new Vector3(0, 0, 1), -Math.min(roomBounds.maxZ - 0.3, Math.max(ballStart.z + 1.4, toy.position.z + 0.55))),
      offset: new Vector2(center.x, center.y).sub(event.pointer),
      downX: event.clientX,
      downY: event.clientY,
      elapsed: 0,
    };
    (event.target as Element).setPointerCapture(event.pointerId);
    moveHeldBall(event, grab);
    state.hovered = false;
    state.motion = grab;
  };

  const pointerMove = (event: ThreeEvent<PointerEvent>) => {
    const state = ball.current;
    if (!event.isPrimary) return;
    const { panel, foodOpen } = useGameUI.getState();
    if (panel || foodOpen) return;
    const motion = state.motion;
    if (motion.phase === "held" && motion.pointer === event.pointerId) {
      event.stopPropagation();
      moveHeldBall(event, motion);
    } else if (motion.phase === "rest" && event.pointerType === "mouse" && event.buttons === 0) {
      event.stopPropagation();
      state.hovered = true;
    }
  };

  const pointerUp = (event: ThreeEvent<PointerEvent>) => {
    const state = ball.current;
    const grab = state.motion;
    if (grab.phase !== "held" || grab.pointer !== event.pointerId) return;
    event.stopPropagation();
    const captured = event.target as Element;
    if (captured.hasPointerCapture(event.pointerId)) captured.releasePointerCapture(event.pointerId);
    const dx = event.clientX - grab.downX;
    const dy = event.clientY - grab.downY;
    const distance = Math.hypot(dx, dy);
    const minimum = event.pointerType === "touch" ? 18 : 12;
    const ui = useGameUI.getState();
    if (distance < minimum || ui.panel || ui.foodOpen || !dog.current) {
      cancelBallGrab(state, event.pointerId);
      return;
    }

    const power = MathUtils.smoothstep(distance, minimum, Math.min(size.width, size.height) * 0.33);
    const range = MathUtils.lerp(0.86, 6.2, power);
    const aim = { x: grab.origin.x + range * dx / distance, z: grab.origin.z + range * dy / distance };
    const landing = chooseBallLanding(dog.current.position, grab.origin, aim);
    if (!landing) {
      cancelBallGrab(state, event.pointerId);
      ui.setNotice("这边空间太小，球放回原处了。");
      return;
    }

    state.motion = {
      phase: "flight",
      from: event.object.position.clone(),
      to: new Vector3(landing.x, ballGroundY, landing.z),
      lift: MathUtils.lerp(1.66, 2.14, power),
      duration: MathUtils.lerp(0.76, 1.13, power),
      // A quick flick still gives the hand time to close before the ball leaves.
      elapsed: Math.min(0, grab.elapsed - ballGripCloseTime),
      play: { sequence: ui.interaction?.sequence ?? 0, owner: useCloudPet.getState().accountId },
    };
    ui.setNotice("球抛出去了！");
  };

  return (
    <mesh
      name="Tennis ball"
      ref={(mesh) => { ball.current.mesh = mesh; }}
      castShadow
      position={[ballStart.x, ballGroundY, ballStart.z]}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerOut={() => { ball.current.hovered = false; }}
      onPointerUp={pointerUp}
    >
      <sphereGeometry args={[ballStart.radius, 24, 16]} />
      <meshStandardMaterial color="#becd74" roughness={0.9} />
    </mesh>
  );
}
