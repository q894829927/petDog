import { Suspense, useEffect, useRef, type PointerEvent, type RefObject } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Vector2, type Mesh, type PerspectiveCamera } from "three";
import { useGameUI } from "../store/useGameUI";
import { AkitaDog } from "./AkitaDog";
import { PlayerHand, type HandContact } from "./PlayerHand";
import { ballGroundY, ballStart, dogBed, foodBowl, rug } from "./roomNavigation";

const roomFov = 37;
const bowlProfile = [
  [0, 0.024], [0.26, 0.024], [0.32, 0.11], [0.31, 0.116],
  [0.29, 0.11], [0.246, 0.047], [0, 0.047],
].map(([x, y]) => new Vector2(x, y));

function FoodBowl() {
  const bowl = useGameUI((state) => state.bowl);
  return (
    <group position={[foodBowl.x, 0, foodBowl.z]}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[bowlProfile, 32]} />
        <meshStandardMaterial color="#698573" roughness={0.54} />
      </mesh>
      {bowl?.kind === "feed" && Array.from({ length: bowl.portions * 5 }, (_, index) => {
        const angle = index * 2.4;
        const radius = Math.sqrt(index / 15) * 0.21;
        return (
          <mesh key={index} position={[Math.cos(angle) * radius, 0.072, Math.sin(angle) * radius]} scale={[1, 0.67, 0.87]}>
            <sphereGeometry args={[0.038, 8, 6]} />
            <meshStandardMaterial color={index % 2 ? "#9d6941" : "#795031"} roughness={0.96} />
          </mesh>
        );
      })}
      {bowl?.kind === "water" && (
        <mesh position={[0, 0.053 + 0.014 * bowl.portions, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.246 + 0.012 * bowl.portions, 32]} />
          <meshStandardMaterial color="#7ab5c6" roughness={0.22} />
        </mesh>
      )}
    </group>
  );
}

function StageCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    const portrait = size.width < 640 && size.width < size.height;
    // Keep the feeding bowl in view on narrow phones.
    const distance = Math.max(portrait ? 9.0 : 7.2, (portrait ? 7.0 : 5.7) * size.height / size.width);
    perspective.position.set(0, portrait ? 2.55 : 2.35, distance);
    perspective.lookAt(0, 1.15, 0);
    perspective.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Room({ shadows, ball }: { shadows: boolean; ball: RefObject<Mesh | null> }) {
  const trigger = useGameUI((state) => state.trigger);
  const tool = useGameUI((state) => state.tool);

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
      <FoodBowl />
      <mesh ref={ball} castShadow position={[ballStart.x, ballGroundY, ballStart.z]}>
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

export function PetWorld() {
  const highQuality = useGameUI((state) => state.quality === "high");
  const ball = useRef<Mesh>(null);
  const handContact = useRef<HandContact | null>(null);
  const releaseHand = (event: PointerEvent<HTMLDivElement>) => {
    const target = handContact.current;
    if (target?.pointer !== event.pointerId) return;
    target.pressed = false;
    target.visibleUntil = event.pointerType === "mouse" ? Infinity : performance.now() + 320;
  };
  const cancelHand = (event: PointerEvent<HTMLDivElement>) => {
    if (handContact.current?.pointer === event.pointerId) handContact.current = null;
  };
  return (
    <div className="world-canvas" aria-label="秋田犬的 3D 宠物房间" onPointerUp={releaseHand} onPointerCancel={cancelHand}>
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
          <AkitaDog ball={ball} handContact={handContact} />
          <PlayerHand contact={handContact} />
        </Suspense>
      </Canvas>
    </div>
  );
}
