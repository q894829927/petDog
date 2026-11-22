import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useLoader } from "@react-three/fiber";
import { RepeatWrapping, Shape, SRGBColorSpace, TextureLoader, Vector2, type MeshBasicMaterial, type Texture } from "three";
import floorColorUrl from "../assets/living-room-floor.webp?url";
import floorNormalUrl from "../assets/living-room-floor-normal.webp?url";
import windowViewUrl from "../assets/living-room-view.webp?url";
import { useGameUI } from "../store/useGameUI";
import { RoomLighting } from "./RoomLighting";
import { dogBed, floorSurface, foodBowl, roomBounds, rug, wallThickness, windowPlant } from "./roomNavigation";

const width = roomBounds.maxX - roomBounds.minX;
const depth = roomBounds.maxZ - roomBounds.minZ;
const wallHeight = 6.25;
const windowOpening = { left: -2.12, right: 4.95, bottom: 0.48, top: 3.63 };
const plaster = "#ece4d4";
const trim = "#b79b77";
const bowlProfile = [
  [0, 0], [0.26, 0], [foodBowl.rimRadius, 0.11], [0.31, foodBowl.height],
  [0.29, 0.11], [0.246, 0.047], [0, 0.047],
].map(([x, y]) => new Vector2(x, y));

function RoomBox({ position, size, color }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={position} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.88} />
    </mesh>
  );
}

function roundedMat(width: number, depth: number, radius: number) {
  const shape = new Shape();
  const x = width / 2;
  const z = depth / 2;
  shape.moveTo(-x + radius, -z);
  shape.lineTo(x - radius, -z);
  shape.quadraticCurveTo(x, -z, x, -z + radius);
  shape.lineTo(x, z - radius);
  shape.quadraticCurveTo(x, z, x - radius, z);
  shape.lineTo(-x + radius, z);
  shape.quadraticCurveTo(-x, z, -x, z - radius);
  shape.lineTo(-x, -z + radius);
  shape.quadraticCurveTo(-x, -z, -x + radius, -z);
  return shape;
}

function InteractionRug() {
  const { border, center } = useMemo(() => ({
    border: roundedMat(rug.width, rug.depth, rug.cornerRadius),
    center: roundedMat(rug.width - 0.18, rug.depth - 0.18, 0.34),
  }), []);
  // The material offsets draw the rug above the wood without moving the shared floor surface.
  return (
    <group name="Interaction rug" position={[rug.x, floorSurface, rug.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh receiveShadow>
        <shapeGeometry args={[border, 10]} />
        <meshStandardMaterial color="#bd9f78" roughness={1} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <mesh receiveShadow>
        <shapeGeometry args={[center, 10]} />
        <meshStandardMaterial color="#e4ceae" roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
    </group>
  );
}

function FoodBowl() {
  const bowl = useGameUI((state) => state.bowl);
  return (
    <group name="Food bowl" position={[foodBowl.x, floorSurface, foodBowl.z]}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[bowlProfile, 40]} />
        <meshStandardMaterial color="#748b72" roughness={0.47} />
      </mesh>
      {bowl?.kind === "feed" && Array.from({ length: bowl.portions * 5 }, (_, index) => {
        const angle = index * 2.4;
        const radius = Math.sqrt(index / 15) * 0.21;
        return (
          <mesh key={index} position={[Math.cos(angle) * radius, 0.072, Math.sin(angle) * radius]} scale={[1, 0.67, 1]}>
            <sphereGeometry args={[0.038, 8, 6]} />
            <meshStandardMaterial color="#704a32" roughness={0.93} />
          </mesh>
        );
      })}
      {bowl?.kind === "water" && (
        <mesh position={[0, 0.053 + 0.014 * bowl.portions, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.246 + 0.012 * bowl.portions, 40]} />
          <meshStandardMaterial color="#a8c8ba" roughness={0.2} />
        </mesh>
      )}
    </group>
  );
}

function PictureWindow({ view, material }: { view: Texture; material: RefObject<MeshBasicMaterial | null> }) {
  const { left, right, bottom, top } = windowOpening;
  const x = (left + right) / 2;
  const y = (bottom + top) / 2;
  const w = right - left;
  const h = top - bottom;
  const z = roomBounds.minZ;
  return (
    <group name="Picture window">
      <RoomBox position={[(roomBounds.minX + left) / 2, wallHeight / 2, z]} size={[left - roomBounds.minX, wallHeight, wallThickness]} color={plaster} />
      <RoomBox position={[(roomBounds.maxX + right) / 2, wallHeight / 2, z]} size={[roomBounds.maxX - right, wallHeight, wallThickness]} color={plaster} />
      <RoomBox position={[x, bottom / 2, z]} size={[w, bottom, wallThickness]} color={plaster} />
      <RoomBox position={[x, (top + wallHeight) / 2, z]} size={[w, wallHeight - top, wallThickness]} color={plaster} />
      <mesh name="Window view" position={[x, y, z - 0.19]}>
        <planeGeometry args={[w + 0.6, h + 0.44]} />
        <meshBasicMaterial ref={material} map={view} toneMapped={false} />
      </mesh>
      {[left, left + w / 3, right - w / 3, right].map((divider) => (
        <RoomBox key={divider} position={[divider, y, z + 0.02]} size={[0.095, h, 0.23]} color={trim} />
      ))}
      <RoomBox position={[x, top, z + 0.04]} size={[w + 0.1, 0.1, 0.28]} color={trim} />
      <RoomBox position={[x, bottom, z + 0.12]} size={[w + 0.26, 0.11, 0.48]} color={trim} />
    </group>
  );
}

function WindowPlant() {
  return (
    <group name="Window plant" position={[windowPlant.x, floorSurface, windowPlant.z]}>
      <mesh position-y={windowPlant.potHeight / 2} castShadow receiveShadow>
        <cylinderGeometry args={[windowPlant.potRadius, 0.19, windowPlant.potHeight, 28]} />
        <meshStandardMaterial color="#b58567" roughness={0.93} />
      </mesh>
      <mesh position-y={0.74} castShadow>
        <cylinderGeometry args={[0.022, 0.038, 0.78, 10]} />
        <meshStandardMaterial color="#596e42" roughness={0.9} />
      </mesh>
      {Array.from({ length: 8 }, (_, index) => {
        const angle = index * 2.4;
        return (
          <mesh key={index} position={[Math.cos(angle) * 0.2, 0.64 + index * 0.092, Math.sin(angle) * 0.2]}
            rotation={[0.25, -angle, -0.42]} scale={[0.28 - index * 0.012, 0.11, 0.053]} castShadow>
            <sphereGeometry args={[1, 14, 8]} />
            <meshStandardMaterial color={index % 2 ? "#688450" : "#78955d"} roughness={0.76} />
          </mesh>
        );
      })}
    </group>
  );
}

export function LivingRoom({ shadows }: { shadows: boolean }) {
  const centerZ = (roomBounds.minZ + roomBounds.maxZ) / 2;
  const windowMaterial = useRef<MeshBasicMaterial>(null);
  const [floorColor, floorNormal, view] = useLoader(TextureLoader, [floorColorUrl, floorNormalUrl, windowViewUrl]);
  useLayoutEffect(() => {
    floorColor.colorSpace = SRGBColorSpace;
    view.colorSpace = SRGBColorSpace;
    view.needsUpdate = true;
    for (const texture of [floorColor, floorNormal]) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(2.2, 2.2 * (depth + 4) / width);
      texture.anisotropy = shadows ? 8 : 2;
      texture.needsUpdate = true;
    }
  }, [floorColor, floorNormal, view, shadows]);

  return (
    <>
      <RoomLighting shadows={shadows} windowMaterial={windowMaterial} />
      <group name="Living room">
        <mesh name="Wood floor" receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, floorSurface, centerZ + 2]}>
          <planeGeometry args={[width, depth + 4]} />
          <meshStandardMaterial color="#dbe0eb" map={floorColor} normalMap={shadows ? floorNormal : null}
            normalScale={[0.37, 0.37]} roughness={0.8} />
        </mesh>
        <RoomBox position={[roomBounds.minX, wallHeight / 2, centerZ]} size={[wallThickness, wallHeight, depth]} color="#e2d7c4" />
        <RoomBox position={[roomBounds.maxX, wallHeight / 2, centerZ]} size={[wallThickness, wallHeight, depth]} color={plaster} />
        <RoomBox position={[0, floorSurface + 0.065, roomBounds.minZ + 0.14]} size={[width, 0.13, 0.08]} color={trim} />
        <PictureWindow view={view} material={windowMaterial} />
        <WindowPlant />
        <InteractionRug />
        <FoodBowl />
        <group name="Dog bed" position={[dogBed.x, floorSurface, dogBed.z]}>
          <mesh position-y={dogBed.rimHeight} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <torusGeometry args={[dogBed.radius - dogBed.rimThickness, dogBed.rimThickness, 16, 56]} />
            <meshStandardMaterial color="#9e7e6e" roughness={0.98} />
          </mesh>
          <mesh position-y={dogBed.cushionHeight / 2} castShadow receiveShadow>
            <cylinderGeometry args={[dogBed.cushionRadius, dogBed.cushionRadius, dogBed.cushionHeight, 48]} />
            <meshStandardMaterial color="#d7bc9f" roughness={1} />
          </mesh>
        </group>
      </group>
    </>
  );
}
