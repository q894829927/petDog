import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  MathUtils,
  Mesh,
  type AnimationAction,
  type Group,
  type PerspectiveCamera,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import akitaHighUrl from "../assets/akita-high.glb?url";
import akitaLowUrl from "../assets/akita.glb?url";
import { useGameUI, type InteractionKind } from "../store/useGameUI";
import { ballStart, chooseWalkTarget, clearsBall, dogBed, foodBowl, rug, type FloorPoint } from "./roomNavigation";

const roomFov = 37;
const roomHalfFov = MathUtils.degToRad(roomFov / 2);

function StageCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    const portrait = size.width < 640 && size.width < size.height;
    const distance = Math.max(portrait ? 9.0 : 7.2, 5.4 * size.height / size.width);
    perspective.position.set(0, portrait ? 2.55 : 2.35, distance);
    perspective.lookAt(0, 1.15, 0);
    perspective.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Room({ shadows, ball }: { shadows: boolean; ball: RefObject<Mesh | null> }) {
  const trigger = useGameUI((state) => state.trigger);
  const tool = useGameUI((state) => state.tool);
  const tossedAt = useRef(-10);
  const interaction = useGameUI((state) => state.interaction);

  useEffect(() => {
    if (interaction?.kind === "ball") tossedAt.current = 0;
  }, [interaction]);

  useFrame((_, delta) => {
    if (!ball.current || tossedAt.current < 0) return;
    tossedAt.current += delta;
    const t = tossedAt.current;
    ball.current.position.x = MathUtils.lerp(ballStart.x, -1.5, Math.min(t / 1.35, 1));
    ball.current.position.y = 0.2 + Math.max(0, Math.sin(t * Math.PI / 1.35) * 0.75);
    ball.current.position.z = MathUtils.lerp(ballStart.z, -0.4, Math.min(t / 1.35, 1));
    ball.current.rotation.x += delta * 5;
    if (t > 1.35) tossedAt.current = -1;
  });

  const onFloorClick = (event: ThreeEvent<MouseEvent>) => {
    if (tool === "ball") {
      event.stopPropagation();
      trigger("ball");
    }
  };

  return (
    <>
      <color attach="background" args={["#e5dac7"]} />
      <fog attach="fog" args={["#e5dac7", 11, 23]} />
      <hemisphereLight args={["#fff5dd", "#c1a57e", 2.15]} />
      <directionalLight position={[3.3, 7, 4.5]} intensity={2.7} color="#fff4d9" castShadow={shadows} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} />
      <ambientLight intensity={0.35} />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} onClick={onFloorClick}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#b6a385" roughness={1} />
      </mesh>
      <mesh position={[0, 3.1, -5.2]} receiveShadow>
        <boxGeometry args={[25, 6.3, 0.25]} />
        <meshStandardMaterial color="#efe2cb" roughness={1} />
      </mesh>
      <mesh position={[-7.3, 3, -0.5]} rotation={[0, 0.31, 0]} receiveShadow>
        <boxGeometry args={[0.25, 6.3, 12]} />
        <meshStandardMaterial color="#dfd2b8" roughness={1} />
      </mesh>
      <mesh position={[-2.7, 2.9, -5.0]}>
        <boxGeometry args={[2.2, 1.72, 0.12]} />
        <meshStandardMaterial color="#b48761" />
      </mesh>
      <mesh position={[-2.7, 2.9, -4.91]}>
        <planeGeometry args={[1.93, 1.45]} />
        <meshStandardMaterial color="#b6c8a7" />
      </mesh>
      <mesh position={[-2.7, 2.55, -4.88]} rotation={[0, 0, 0.1]}>
        <circleGeometry args={[0.44, 32]} />
        <meshStandardMaterial color="#f4d6a0" />
      </mesh>
      <mesh position={[-2.5, 2.34, -4.875]}>
        <coneGeometry args={[0.7, 0.85, 4]} />
        <meshStandardMaterial color="#6a8775" />
      </mesh>
      <mesh position={[2.95, 2.7, -5.0]}>
        <boxGeometry args={[1.55, 2.3, 0.11]} />
        <meshStandardMaterial color="#c09f72" />
      </mesh>
      <mesh position={[2.95, 2.7, -4.93]}>
        <planeGeometry args={[1.36, 2.1]} />
        <meshStandardMaterial color="#f9edcd" emissive="#ebd6a0" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[2.95, 2.7, -4.88]}>
        <boxGeometry args={[0.07, 2.08, 0.08]} />
        <meshStandardMaterial color="#c09f72" />
      </mesh>
      <mesh position={[2.95, 2.7, -4.88]}>
        <boxGeometry args={[1.36, 0.07, 0.08]} />
        <meshStandardMaterial color="#c09f72" />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[rug.x, 0.022, rug.z]}>
        <circleGeometry args={[rug.radius, 64]} />
        <meshStandardMaterial color="#e6d6b9" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[rug.x, 0.023, rug.z]}>
        <ringGeometry args={[2.37, 2.46, 64]} />
        <meshStandardMaterial color="#d4bea0" />
      </mesh>
      <group position={[foodBowl.x, 0.06, foodBowl.z]}>
        <mesh castShadow receiveShadow position={[0, 0.12, 0]}>
          <cylinderGeometry args={[foodBowl.radius, 0.27, 0.22, 32]} />
          <meshStandardMaterial color="#698573" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.243, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.31, 32]} />
          <meshStandardMaterial color="#937451" />
        </mesh>
      </group>
      <mesh ref={ball} castShadow position={[ballStart.x, 0.2, ballStart.z]}>
        <sphereGeometry args={[ballStart.radius, 24, 16]} />
        <meshStandardMaterial color="#becd74" roughness={0.9} />
      </mesh>
      <mesh position={[dogBed.x, 0.12, dogBed.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[dogBed.radius - 0.2, 0.2, 12, 48]} />
        <meshStandardMaterial color="#b9846c" roughness={1} />
      </mesh>
      <mesh position={[dogBed.x, 0.035, dogBed.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[dogBed.radius - 0.2, 40]} />
        <meshStandardMaterial color="#eac6ac" roughness={1} />
      </mesh>
      <group position={[4, 0, -3.0]}>
        <mesh position={[0, 0.28, 0]} castShadow>
          <cylinderGeometry args={[0.34, 0.28, 0.55, 12]} />
          <meshStandardMaterial color="#bd8c6d" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.92, 0]}>
          <sphereGeometry args={[0.59, 12, 10]} />
          <meshStandardMaterial color="#7e977b" roughness={1} />
        </mesh>
        <mesh position={[0.3, 1.12, -0.1]}>
          <sphereGeometry args={[0.4, 12, 10]} />
          <meshStandardMaterial color="#6e896f" roughness={1} />
        </mesh>
      </group>
    </>
  );
}

const interactionClips: Record<InteractionKind, string> = {
  pet: "Pet",
  call: "LookAround",
  feed: "Eat",
  water: "Drink",
  ball: "Play",
  brush: "Pet",
};

const dogScale = 2.65;
// The matching Walk_F_RM clip advances 0.519 m in one second.
const walkSpeed = 0.519 * dogScale;

function AkitaDog({ ball }: { ball: RefObject<Mesh | null> }) {
  const quality = useGameUI((state) => state.quality);
  const modelQuality = useDeferredValue(quality);
  const { scene, animations } = useLoader(GLTFLoader, modelQuality === "high" ? akitaHighUrl : akitaLowUrl);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const dog = useRef<Group>(null);
  const roaming = useRef<{ target: FloorPoint | null; restTime: number }>({ target: null, restTime: 1.7 });
  const currentAction = useRef<AnimationAction | null>(null);
  const playback = useRef({ name: "Idle", time: 0, interactionSequence: 0 });
  const interaction = useGameUI((state) => state.interaction);
  const trigger = useGameUI((state) => state.trigger);
  const tool = useGameUI((state) => state.tool);
  const lastPetAt = useRef(-Infinity);

  const play = useCallback((name: string, time = 0) => {
    const clip = AnimationClip.findByName(animations, name);
    if (!clip) throw new Error("Akita animation missing: " + name);

    const action = mixer.clipAction(clip);
    const previous = currentAction.current;
    if (previous === action) return;

    action.reset();
    action.time = time;
    if (name !== "Idle" && name !== "Walk") {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.play();
    previous?.crossFadeTo(action, 0.25, false);
    currentAction.current = action;
  }, [animations, mixer]);

  const rest = useCallback(() => {
    roaming.current.target = null;
    roaming.current.restTime = MathUtils.randFloat(2.2, 4.4);
    play("Idle");
  }, [play]);

  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
    play(playback.current.name, playback.current.time);

    const onFinished = ({ action }: { action: AnimationAction }) => {
      if (action === currentAction.current) rest();
    };
    mixer.addEventListener("finished", onFinished);
    return () => {
      mixer.removeEventListener("finished", onFinished);
      const action = currentAction.current;
      if (action) {
        playback.current.name = action.getClip().name;
        playback.current.time = action.time;
      }
      mixer.stopAllAction();
      currentAction.current = null;
    };
  }, [mixer, play, rest, scene]);

  useEffect(() => {
    if (interaction && interaction.sequence !== playback.current.interactionSequence) {
      roaming.current.target = null;
      play(interactionClips[interaction.kind]);
      playback.current.interactionSequence = interaction.sequence;
    }
  }, [interaction, play]);

  useFrame(({ camera, size }, delta) => {
    const step = Math.min(delta, 0.1);
    mixer.update(step);

    const group = dog.current;
    const action = currentAction.current;
    if (!group || !action) return;

    const activity = roaming.current;
    const ballPosition = ball.current?.position ?? ballStart;
    const clip = action.getClip().name;
    if (clip === "Idle") {
      activity.restTime -= step;
      if (activity.restTime > 0) return;
      const viewWidthPerDepth = Math.tan(roomHalfFov) * size.width / size.height;
      activity.target = chooseWalkTarget(group.position, ballPosition, camera.position.z, viewWidthPerDepth);
      if (activity.target) play("Walk");
      else rest();
      return;
    }
    const target = activity.target;
    if (clip !== "Walk" || !target) return;
    if (!clearsBall(group.position, target, ballPosition)) {
      rest();
      return;
    }

    const dx = target.x - group.position.x;
    const dz = target.z - group.position.z;
    const heading = Math.atan2(dx, dz);
    const turn = MathUtils.euclideanModulo(heading - group.rotation.y + Math.PI, 2 * Math.PI) - Math.PI;
    const motionStep = step * action.getEffectiveWeight();
    const turnStep = 3.7 * motionStep;
    if (Math.abs(turn) > turnStep) {
      group.rotation.y += Math.sign(turn) * turnStep;
      return;
    }
    group.rotation.y = heading;

    const remaining = Math.hypot(dx, dz);
    const fraction = Math.min(1, walkSpeed * motionStep / remaining);
    group.position.x = MathUtils.lerp(group.position.x, target.x, fraction);
    group.position.z = MathUtils.lerp(group.position.z, target.z, fraction);

    if (fraction === 1) {
      activity.target = null;
      if (Math.random() < 0.5) play("Sit");
      else rest();
    }
  });

  const reactToClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (tool === "ball" || tool === "brush") {
      trigger(tool);
      return;
    }

    const now = performance.now();
    if (now - lastPetAt.current < 400) return;
    lastPetAt.current = now;
    trigger("pet");
  };

  return (
    <group
      ref={dog}
      position={[0.12, 0.026, 0.35]}
      rotation={[0, -0.65, 0]}
      scale={dogScale}
      onClick={reactToClick}
    >
      <primitive object={scene} />
    </group>
  );
}

export function PetWorld() {
  const highQuality = useGameUI((state) => state.quality === "high");
  const ball = useRef<Mesh>(null);
  return (
    <div className="world-canvas" aria-label="秋田犬的 3D 宠物房间">
      <Canvas
        shadows={highQuality}
        dpr={highQuality ? [1, 1.75] : [1, 1.1]}
        camera={{ fov: roomFov, position: [0, 2.35, 7.2], near: 0.1, far: 50 }}
        gl={{ antialias: highQuality, powerPreference: "high-performance" }}
        fallback={<div className="webgl-fallback">当前设备无法加载 3D 场景，请尝试其他浏览器。</div>}
      >
        <StageCamera />
        <Room shadows={highQuality} ball={ball} />
        <Suspense fallback={null}>
          <AkitaDog ball={ball} />
        </Suspense>
      </Canvas>
    </div>
  );
}
