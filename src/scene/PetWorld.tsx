import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { MathUtils, type Group, type Mesh, type PerspectiveCamera } from "three";
import { useGameUI, type InteractionKind } from "../store/useGameUI";

function StageCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    const portrait = size.width < 640 && size.width < size.height;
    perspective.position.set(0, portrait ? 2.55 : 2.35, portrait ? 9.0 : 7.2);
    perspective.lookAt(0, 1.15, 0);
    perspective.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Room() {
  const trigger = useGameUI((state) => state.trigger);
  const tool = useGameUI((state) => state.tool);
  const ball = useRef<Mesh>(null);
  const tossedAt = useRef(-10);
  const interaction = useGameUI((state) => state.interaction);

  useEffect(() => {
    if (interaction?.kind === "ball") tossedAt.current = 0;
  }, [interaction]);

  useFrame((_, delta) => {
    if (!ball.current || tossedAt.current < 0) return;
    tossedAt.current += delta;
    const t = tossedAt.current;
    ball.current.position.x = MathUtils.lerp(1.65, -0.95, Math.min(t / 1.35, 1));
    ball.current.position.y = 0.2 + Math.max(0, Math.sin(t * Math.PI / 1.35) * 0.75);
    ball.current.position.z = MathUtils.lerp(0.85, -0.4, Math.min(t / 1.35, 1));
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
      <directionalLight position={[3.3, 7, 4.5]} intensity={2.7} color="#fff4d9" castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} />
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
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0.32]}>
        <circleGeometry args={[2.62, 64]} />
        <meshStandardMaterial color="#e6d6b9" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.023, 0.32]}>
        <ringGeometry args={[2.37, 2.46, 64]} />
        <meshStandardMaterial color="#d4bea0" />
      </mesh>
      <group position={[-1.82, 0.06, 0.91]}>
        <mesh castShadow receiveShadow position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.37, 0.27, 0.22, 32]} />
          <meshStandardMaterial color="#698573" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.243, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.31, 32]} />
          <meshStandardMaterial color="#937451" />
        </mesh>
      </group>
      <mesh ref={ball} castShadow position={[1.65, 0.2, 0.85]}>
        <sphereGeometry args={[0.19, 24, 16]} />
        <meshStandardMaterial color="#becd74" roughness={0.9} />
      </mesh>
      <mesh position={[1.93, 0.12, -1.85]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.8, 0.2, 12, 48]} />
        <meshStandardMaterial color="#b9846c" roughness={1} />
      </mesh>
      <mesh position={[1.93, 0.035, -1.85]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.8, 40]} />
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

function ShibaDog() {
  const group = useRef<Group>(null);
  const head = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const motion = useRef<{ kind: InteractionKind; until: number } | null>(null);
  const interaction = useGameUI((state) => state.interaction);
  const trigger = useGameUI((state) => state.trigger);
  const tool = useGameUI((state) => state.tool);
  const lastPetAt = useRef(0);

  useEffect(() => {
    if (interaction) motion.current = { kind: interaction.kind, until: 1.5 };
  }, [interaction]);

  useFrame((state, delta) => {
    if (!group.current || !head.current || !tail.current) return;
    const now = state.clock.elapsedTime;
    if (motion.current) {
      motion.current.until = Math.max(0, motion.current.until - delta);
      if (motion.current.until === 0) motion.current = null;
    }
    const kind = motion.current?.kind;
    const excitement = kind === "call" || kind === "ball" ? 1 : kind === "pet" || kind === "brush" ? 0.5 : 0;
    group.current.position.y = Math.sin(now * (1.55 + excitement * 2.4)) * (0.024 + excitement * 0.07);
    group.current.rotation.y = Math.sin(now * 0.42) * 0.07 + (kind === "ball" ? -0.12 : 0);
    head.current.rotation.z = Math.sin(now * 0.93) * 0.06 + (kind === "pet" ? -0.12 : 0);
    head.current.rotation.x = (kind === "feed" || kind === "water") ? 0.22 : Math.sin(now * 0.7) * 0.025;
    tail.current.rotation.z = Math.sin(now * (3.8 + excitement * 6.2)) * (0.19 + excitement * 0.3);
  });

  const reactToPointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (tool === "ball") {
      trigger("ball");
    } else if (tool === "brush") {
      trigger("brush");
    } else {
      const now = performance.now();
      if (now - lastPetAt.current < 400) return;
      lastPetAt.current = now;
      trigger("pet");
    }
  };

  return (
    <group ref={group} position={[0, 0, 0.72]} onPointerDown={reactToPointer}>
      <mesh castShadow position={[0, 0.8, -0.23]} scale={[0.72, 0.76, 1.04]}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshStandardMaterial color="#ca763c" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0, 0.69, 0.25]} scale={[0.54, 0.58, 0.42]}>
        <sphereGeometry args={[1, 24, 20]} />
        <meshStandardMaterial color="#f8e8cb" roughness={1} />
      </mesh>
      {([-0.48, 0.48] as const).map((x) => (
        <group key={x}>
          <mesh castShadow position={[x, 0.38, 0.41]} scale={[0.24, 0.39, 0.27]}>
            <sphereGeometry args={[1, 24, 18]} />
            <meshStandardMaterial color="#cb763b" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[x, 0.15, 0.56]} scale={[0.27, 0.18, 0.33]}>
            <sphereGeometry args={[1, 24, 18]} />
            <meshStandardMaterial color="#f8e8cf" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[x * 1.12, 0.31, -0.86]} scale={[0.31, 0.34, 0.32]}>
            <sphereGeometry args={[1, 24, 18]} />
            <meshStandardMaterial color="#c46c35" roughness={0.9} />
          </mesh>
        </group>
      ))}
      <group ref={tail} position={[0, 1.13, -1.02]}>
        <mesh castShadow rotation={[Math.PI / 4, 0.15, 0]} position={[0, 0.16, -0.2]}>
          <torusGeometry args={[0.3, 0.16, 12, 36, Math.PI * 1.8]} />
          <meshStandardMaterial color="#c87840" roughness={0.92} />
        </mesh>
      </group>
      <group ref={head} position={[0, 1.52, 0.38]}>
        <mesh castShadow scale={[0.75, 0.72, 0.68]}>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial color="#d88949" roughness={0.95} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <group key={side} position={[side * 0.5, 0.63, -0.1]} rotation={[0, 0, -side * 0.18]}>
            <mesh castShadow position={[0, 0.16, 0]}>
              <coneGeometry args={[0.27, 0.62, 4]} />
              <meshStandardMaterial color="#c9743e" roughness={0.95} />
            </mesh>
            <mesh position={[0, 0.17, 0.155]} scale={[0.15, 0.32, 0.07]}>
              <sphereGeometry args={[1, 16, 12]} />
              <meshStandardMaterial color="#e9b4a3" roughness={1} />
            </mesh>
          </group>
        ))}
        <mesh position={[-0.37, -0.17, 0.5]} scale={[0.32, 0.42, 0.22]}>
          <sphereGeometry args={[1, 24, 18]} />
          <meshStandardMaterial color="#faedd7" roughness={1} />
        </mesh>
        <mesh position={[0.37, -0.17, 0.5]} scale={[0.32, 0.42, 0.22]}>
          <sphereGeometry args={[1, 24, 18]} />
          <meshStandardMaterial color="#faedd7" roughness={1} />
        </mesh>
        <mesh position={[0, -0.34, 0.56]} scale={[0.42, 0.25, 0.32]}>
          <sphereGeometry args={[1, 24, 18]} />
          <meshStandardMaterial color="#f9eace" roughness={1} />
        </mesh>
        <mesh position={[0, -0.25, 0.85]} scale={[0.16, 0.095, 0.12]}>
          <sphereGeometry args={[1, 20, 16]} />
          <meshStandardMaterial color="#362b28" roughness={0.7} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 0.32, 0.08, 0.62]} scale={[0.08, 0.095, 0.075]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color="#292824" roughness={0.25} />
          </mesh>
        ))}
        <mesh position={[0, -0.57, 0.39]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.44, 0.055, 8, 32, Math.PI]} />
          <meshStandardMaterial color="#587465" roughness={0.55} />
        </mesh>
        <mesh position={[0, -0.64, 0.82]} scale={[0.11, 0.12, 0.05]}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="#d9b771" metalness={0.35} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

export function PetWorld() {
  const quality = useGameUI((state) => state.quality);
  return (
    <div className="world-canvas" aria-label="柴犬的 3D 宠物房间">
      <Canvas
        shadows={quality === "high"}
        dpr={quality === "high" ? [1, 1.75] : [1, 1.1]}
        camera={{ fov: 37, position: [0, 2.35, 7.2], near: 0.1, far: 50 }}
        gl={{ antialias: quality === "high", powerPreference: "high-performance" }}
        fallback={<div className="webgl-fallback">当前设备无法加载 3D 场景，请尝试其他浏览器。</div>}
      >
        <StageCamera />
        <Room />
        <ShibaDog />
      </Canvas>
    </div>
  );
}
