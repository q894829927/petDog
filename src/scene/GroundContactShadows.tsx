import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { DataTexture, LinearFilter, MathUtils, Vector3, type Group, type Mesh, type MeshBasicMaterial, type Object3D, type PlaneGeometry } from "three";
import { ballGroundY, ballStart, dogBed, dogHome, floorSurface, foodBowl, windowPlant, type FloorPoint } from "./roomNavigation";
import type { BallState } from "./TennisBall";

const ballShadowWidth = 0.47;
const ballShadowOpacity = 0.31;

function createShadowMap(coreRadius: number) {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5);
      pixels[(y * size + x) * 4 + 3] = Math.round(255 * (1 - MathUtils.smoothstep(distance, coreRadius, 0.5)));
    }
  }
  const map = new DataTexture(pixels, size, size);
  map.magFilter = map.minFilter = LinearFilter;
  map.needsUpdate = true;
  return map;
}

const softShadowMap = createShadowMap(0.04);
const closeShadowMap = createShadowMap(0.14);
type ShadowMesh = Mesh<PlaneGeometry, MeshBasicMaterial>;

export type DogShadowAnchors = { hips: Object3D; chest: Object3D; muzzle: Object3D };

function ContactShadow({ name, point, width, length, opacity, meshRef, map = softShadowMap }: {
  name: string;
  point: FloorPoint;
  width: number;
  length: number;
  opacity: number;
  meshRef?: RefObject<ShadowMesh | null>;
  map?: DataTexture;
}) {
  return (
    <mesh name={name} ref={meshRef} position={[point.x, floorSurface, point.z]} scale={[width, length, 1]}
      rotation={[-Math.PI / 2, 0, 0]} visible={!meshRef}>
      <planeGeometry />
      <meshBasicMaterial color="#574835" map={map} opacity={opacity} transparent depthWrite={false} toneMapped={false}
        polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
    </mesh>
  );
}

export function GroundContactShadows({ ball, dog, dogAnchors }: {
  ball: RefObject<BallState>;
  dog: RefObject<Group | null>;
  dogAnchors: RefObject<DogShadowAnchors | null>;
}) {
  const dogShadow = useRef<ShadowMesh>(null);
  const torsoShadow = useRef<ShadowMesh>(null);
  const muzzleShadow = useRef<ShadowMesh>(null);
  const anchorsWorld = useRef({ hips: new Vector3(), chest: new Vector3(), muzzle: new Vector3() });
  const ballShadow = useRef<ShadowMesh>(null);

  useFrame(() => {
    const pet = dog.current;
    const petShadow = dogShadow.current;
    const torso = torsoShadow.current;
    const muzzle = muzzleShadow.current;
    const anchors = dogAnchors.current;
    if (pet && petShadow && torso && muzzle && anchors) {
      const points = anchorsWorld.current;
      const hips = anchors.hips.getWorldPosition(points.hips);
      const chest = anchors.chest.getWorldPosition(points.chest);
      const nose = anchors.muzzle.getWorldPosition(points.muzzle);
      const settled = 1 - MathUtils.smoothstep((hips.y + chest.y) / 2 - floorSurface, 0.44, 0.76);
      petShadow.position.set(
        MathUtils.lerp(pet.position.x, (hips.x + nose.x) / 2, settled),
        floorSurface,
        MathUtils.lerp(pet.position.z, (hips.z + nose.z) / 2, settled),
      );
      petShadow.rotation.z = pet.rotation.y;
      petShadow.scale.set(MathUtils.lerp(1.36, 1.22, settled), MathUtils.lerp(2.6, 2.46, settled), 1);
      petShadow.material.opacity = MathUtils.lerp(0.24, 0.18, settled);
      petShadow.visible = true;

      const forwardX = chest.x - hips.x;
      const forwardZ = chest.z - hips.z;
      torso.position.set((hips.x + chest.x) / 2, floorSurface, (hips.z + chest.z) / 2);
      torso.rotation.z = Math.atan2(forwardX, forwardZ);
      torso.scale.set(0.96, Math.hypot(forwardX, forwardZ) + 0.92, 1);
      torso.material.opacity = settled * 0.31;
      torso.visible = settled > 0;

      const muzzleContact = settled * (1 - MathUtils.smoothstep(nose.y - floorSurface, 0.1, 0.33));
      muzzle.position.set(nose.x, floorSurface, nose.z);
      muzzle.rotation.z = torso.rotation.z;
      muzzle.material.opacity = 0.28 * muzzleContact;
      muzzle.visible = muzzleContact > 0;
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
      <ContactShadow name="Akita torso contact shadow" point={dogHome} width={0.96} length={1.74} opacity={0}
        map={closeShadowMap} meshRef={torsoShadow} />
      <ContactShadow name="Akita muzzle contact shadow" point={dogHome} width={0.53} length={0.64} opacity={0}
        map={closeShadowMap} meshRef={muzzleShadow} />
      <ContactShadow name="Ball contact shadow" point={ballStart} width={ballShadowWidth} length={ballShadowWidth}
        opacity={ballShadowOpacity} meshRef={ballShadow} />
    </group>
  );
}
