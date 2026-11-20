import { useEffect, useMemo, type RefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MathUtils, Plane, Raycaster, RepeatWrapping, SRGBColorSpace, Vector2, Vector3, type Group, type Mesh } from "three";
import { useCloudPet } from "../cloud/useCloudPet";
import { useGameUI } from "../store/useGameUI";
import { ballBounds, ballPhysicsStep, planBallThrow, predictBallPath, stepBall, type BallBody } from "./ballPhysics";
import { ballGroundY, ballStart, roomBounds, type FloorPoint } from "./roomNavigation";

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
  direction: Vector3;
  spinAxis: Vector3;
  spinSpeed: number;
  body: BallBody;
  prediction: ReturnType<typeof predictBallPath>;
  elapsed: number;
  accumulator: number;
  play: { sequence: number; owner: number | null } | null;
};

type BallPutBack = { phase: "putBack"; from: Vector3; to: Vector3; elapsed: number };

export type BallState = {
  mesh: Mesh | null;
  hovered: boolean;
  motion: { phase: "rest" } | { phase: "fetch"; owner: number | null } | BallGrab | BallFlight | BallPutBack;
};

export const ballGripCloseTime = 0.14;
export const ballPutBackTime = 0.28;

function createBallTexture() {
  const width = 128;
  const height = 64;
  const pixels = new Uint8Array(width * height * 4);
  for (let x = 0; x < width; x++) {
    const seamY = 0.5 + 0.22 * Math.sin(4 * Math.PI * (x + 0.5) / width);
    for (let y = 0; y < height; y++) {
      const seam = 1 - MathUtils.smoothstep(Math.abs((y + 0.5) / height - seamY), 0.008, 0.021);
      const index = (y * width + x) * 4;
      pixels[index] = 190 + seam * 43;
      pixels[index + 1] = 205 + seam * 27;
      pixels[index + 2] = 116 + seam * 76;
      pixels[index + 3] = 255;
    }
  }
  const map = new DataTexture(pixels, width, height);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

const ballTexture = createBallTexture();

function launchBall(from: Vector3, velocity: Vector3, prediction: BallFlight["prediction"], elapsed: number, play: BallFlight["play"]): BallFlight {
  const direction = new Vector3(velocity.x, 0, velocity.z).normalize();
  return {
    phase: "flight", from, direction,
    spinAxis: new Vector3(direction.z, 0, -direction.x),
    spinSpeed: Math.hypot(velocity.x, velocity.z) * 3,
    body: { position: from.clone(), velocity, rolling: false },
    prediction, elapsed, accumulator: 0, play,
  };
}

export function dropBall(ball: BallState) {
  if (!ball.mesh || ball.mesh.position.y <= ballGroundY) {
    ball.motion = { phase: "rest" };
    return;
  }
  const from = ball.mesh.position.clone();
  const velocity = new Vector3();
  ball.motion = launchBall(from, velocity, predictBallPath(from, velocity), 0, null);
}

export function ballFloorPoint({ mesh, motion }: BallState): FloorPoint {
  if (motion.phase === "held") return motion.origin;
  if (motion.phase === "putBack") return motion.to;
  if (motion.phase === "flight") return motion.body.rolling ? motion.body.position : motion.prediction.rest;
  return mesh?.position ?? ballStart;
}

export function cancelBallGrab(ball: BallState, pointer: number) {
  const { mesh, motion } = ball;
  if (!mesh || motion.phase !== "held" || motion.pointer !== pointer) return;
  if (mesh.position.distanceToSquared(motion.origin) < 0.00001) {
    mesh.position.copy(motion.origin);
    ball.motion = { phase: "rest" };
    return;
  }
  ball.motion = { phase: "putBack", from: mesh.position.clone(), to: motion.origin, elapsed: 0 };
}

export function TennisBall({ ball, dog }: {
  ball: RefObject<BallState>;
  dog: RefObject<Group | null>;
}) {
  const { gl, camera, size } = useThree();
  const { ray, pointer, liftGoal, rollAxis } = useMemo(() => ({
    ray: new Raycaster(), pointer: new Vector2(), liftGoal: new Vector3(), rollAxis: new Vector3(),
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
    } else if (motion.phase === "putBack") {
      motion.elapsed += step;
      const placement = MathUtils.smootherstep(motion.elapsed, 0, ballPutBackTime);
      if (placement === 1) {
        toy.position.copy(motion.to);
        state.motion = { phase: "rest" };
      } else {
        toy.position.lerpVectors(motion.from, motion.to, placement);
      }
    } else if (motion.phase === "flight") {
      motion.elapsed += step;
      motion.accumulator += MathUtils.clamp(motion.elapsed, 0, step);
      while (motion.accumulator >= ballPhysicsStep) {
        motion.accumulator -= ballPhysicsStep;
        const settled = stepBall(motion.body);
        const next = motion.body.position;
        if (motion.body.rolling) {
          rollAxis.set(next.z - toy.position.z, 0, toy.position.x - next.x);
          const distance = rollAxis.length();
          if (distance > 0) toy.rotateOnWorldAxis(rollAxis.divideScalar(distance), distance / ballStart.radius);
        } else {
          toy.rotateOnWorldAxis(motion.spinAxis, motion.spinSpeed * ballPhysicsStep);
        }
        toy.position.copy(next);
        if (!settled) continue;

        if (motion.play?.sequence === (ui.interaction?.sequence ?? 0)) {
          state.motion = { phase: "fetch", owner: motion.play.owner };
          ui.trigger("ball");
        } else {
          state.motion = { phase: "rest" };
        }
        break;
      }
    }
  }, -1);

  const moveHeldBall = (event: ThreeEvent<PointerEvent>, grab: BallGrab) => {
    ray.setFromCamera(pointer.copy(event.pointer).add(grab.offset), camera);
    ray.ray.intersectPlane(grab.plane, grab.goal);
    grab.goal.x = MathUtils.clamp(grab.goal.x, ballBounds.minX, ballBounds.maxX);
    grab.goal.y = MathUtils.clamp(grab.goal.y + 0.23, 0.45, 2.8);
  };

  const pointerDown = (event: ThreeEvent<PointerEvent>) => {
    const state = ball.current;
    const { panel, foodOpen } = useGameUI.getState();
    if (!event.isPrimary || event.button !== 0 || panel || foodOpen || state.motion.phase !== "rest" || !dog.current) return;
    event.stopPropagation();
    const toy = event.object as Mesh;
    const center = toy.position.clone().project(camera);
    const reachZ = MathUtils.clamp(toy.position.z + 0.55, ballStart.z + 1.4, roomBounds.maxZ - 0.3);
    const grab: BallGrab = {
      phase: "held",
      pointer: event.pointerId,
      origin: toy.position.clone(),
      goal: toy.position.clone(),
      plane: new Plane(new Vector3(0, 0, 1), -reachZ),
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
    const dx = event.clientX - grab.downX;
    const dy = event.clientY - grab.downY;
    const distance = Math.hypot(dx, dy);
    const minimum = event.pointerType === "touch" ? 18 : 12;
    const ui = useGameUI.getState();
    if (distance < minimum || ui.panel || ui.foodOpen || !dog.current) {
      cancelBallGrab(state, event.pointerId);
    } else {
      const power = MathUtils.smoothstep(distance, minimum, Math.min(size.width, size.height) * 0.33);
      const from = event.object.position.clone();
      const direction = new Vector3(dx / distance, 0, dy / distance);
      const shot = planBallThrow(dog.current.position, from, direction, power);
      if (shot) {
        // A quick flick still gives the hand time to close before the ball leaves.
        const delay = Math.min(0, grab.elapsed - ballGripCloseTime);
        state.motion = launchBall(from, shot.velocity, shot.prediction, delay, {
          sequence: ui.interaction?.sequence ?? 0, owner: useCloudPet.getState().accountId,
        });
        ui.setNotice("球抛出去了！");
      } else {
        cancelBallGrab(state, event.pointerId);
        ui.setNotice("这边空间太小，球放回原处了。");
      }
    }
    const captured = event.target as Element;
    if (captured.hasPointerCapture(event.pointerId)) captured.releasePointerCapture(event.pointerId);
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
      <meshStandardMaterial map={ballTexture} roughness={0.9} />
    </mesh>
  );
}
