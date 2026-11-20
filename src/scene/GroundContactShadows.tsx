import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { DataTexture, LinearFilter, MathUtils, type Group, type Mesh, type MeshBasicMaterial, type PlaneGeometry } from "three";
import { ballGroundY, ballStart, dogBed, dogHome, floorSurface, foodBowl, windowPlant, type FloorPoint } from "./roomNavigation";
import type { BallState } from "./TennisBall";

const ballShadowWidth = 0.47;
const ballShadowOpacity = 0.31;

function createShadowMap() {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5);
      pixels[(y * size + x) * 4 + 3] = Math.round(255 * (1 - MathUtils.smoothstep(distance, 0.04, 0.5)));
    }
  }
  const map = new DataTexture(pixels, size, size);
  map.magFilter = map.minFilter = LinearFilter;
  map.needsUpdate = true;
  return map;
}

const softShadowMap = createShadowMap();
type ShadowMesh = Mesh<PlaneGeometry, MeshBasicMaterial>;

function ContactShadow({ name, point, width, length, opacity, meshRef }: {
  name: string;
  point: FloorPoint;
  width: number;
  length: number;
  opacity: number;
  meshRef?: RefObject<ShadowMesh | null>;
}) {
  return (
    <mesh name={name} ref={meshRef} position={[point.x, floorSurface, point.z]} scale={[width, length, 1]}
      rotation={[-Math.PI / 2, 0, 0]} visible={!meshRef}>
      <planeGeometry />
      <meshBasicMaterial color="#574835" map={softShadowMap} opacity={opacity} transparent depthWrite={false} toneMapped={false}
        polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
    </mesh>
  );
}

export function GroundContactShadows({ ball, dog }: {
  ball: RefObject<BallState>;
  dog: RefObject<Group | null>;
}) {
  const dogShadow = useRef<ShadowMesh>(null);
  const ballShadow = useRef<ShadowMesh>(null);

  useFrame(() => {
    const pet = dog.current;
    const petShadow = dogShadow.current;
    if (pet && petShadow) {
      petShadow.position.set(pet.position.x, floorSurface, pet.position.z);
      petShadow.rotation.z = pet.rotation.y;
      petShadow.visible = true;
    }

    const toy = ball.current.mesh;
    const toyShadow = ballShadow.current;
    if (toy && toyShadow) {
      const height = toy.position.y - ballGroundY;
      const lift = MathUtils.smoothstep(height, 0, 0.52);
      const width = ballShadowWidth + 0.17 * lift;
      toyShadow.position.set(toy.position.x, floorSurface, toy.position.z);
      toyShadow.scale.set(width, width, 1);
      toyShadow.material.opacity = ballShadowOpacity * (1 - lift);
      toyShadow.visible = lift < 1;
    }
  });

  return (
    <group name="Ground contact shadows">
      <ContactShadow name="Bowl contact shadow" point={foodBowl} width={0.73} length={0.73} opacity={0.3} />
      <ContactShadow name="Bed contact shadow" point={dogBed} width={2.18} length={2.18} opacity={0.31} />
      <ContactShadow name="Plant contact shadow" point={windowPlant} width={0.58} length={0.58} opacity={0.3} />
      <ContactShadow name="Akita contact shadow" point={dogHome} width={1.36} length={2.6} opacity={0.24} meshRef={dogShadow} />
      <ContactShadow name="Ball contact shadow" point={ballStart} width={ballShadowWidth} length={ballShadowWidth}
        opacity={ballShadowOpacity} meshRef={ballShadow} />
    </group>
  );
}
