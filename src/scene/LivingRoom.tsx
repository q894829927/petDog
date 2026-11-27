import { useLayoutEffect, useRef, type RefObject } from "react";
import { useLoader } from "@react-three/fiber";
import { RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, type MeshBasicMaterial, type Texture } from "three";
import floorColorUrl from "../assets/living-room-floor.webp?url";
import floorNormalUrl from "../assets/living-room-floor-normal.webp?url";
import floorRoughnessUrl from "../assets/living-room-floor-roughness.webp?url&no-inline";
import windowViewUrl from "../assets/living-room-view.webp?url";
import { useGameUI } from "../store/useGameUI";
import { DogBed } from "./DogBed";
import { InteractionRug } from "./InteractionRug";
import { RoomLighting } from "./RoomLighting";
import { floorSurface, foodBowl, roomBounds, wallThickness, windowPlant } from "./roomNavigation";

const width = roomBounds.maxX - roomBounds.minX;
const depth = roomBounds.maxZ - roomBounds.minZ;
// Nine boards across the scan give each plank a width of about 0.42 room units.
const floorTileSize = 3.8;
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
  const [floorColor, view] = useLoader(TextureLoader, [floorColorUrl, windowViewUrl]);
  const [floorNormal, floorRoughness] = useLoader(TextureLoader, shadows ? [floorNormalUrl, floorRoughnessUrl] : []);
  useLayoutEffect(() => {
    floorColor.colorSpace = SRGBColorSpace;
    view.colorSpace = SRGBColorSpace;
    view.needsUpdate = true;
    for (const texture of [floorColor, floorNormal, floorRoughness]) {
      if (!texture) continue;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(width / floorTileSize, (depth + 4) / floorTileSize);
      texture.anisotropy = shadows ? 8 : 2;
      texture.needsUpdate = true;
    }
  }, [floorColor, floorNormal, floorRoughness, view, shadows]);

  return (
    <>
      <RoomLighting shadows={shadows} windowMaterial={windowMaterial} />
      <group name="Living room">
        <mesh name="Wood floor" receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, floorSurface, centerZ + 2]}>
          <planeGeometry args={[width, depth + 4]} />
          <meshStandardMaterial map={floorColor} normalMap={floorNormal ?? null}
            roughnessMap={floorRoughness ?? null} roughness={shadows ? 1 : 0.62} />
        </mesh>
        <RoomBox position={[roomBounds.minX, wallHeight / 2, centerZ]} size={[wallThickness, wallHeight, depth]} color="#e2d7c4" />
        <RoomBox position={[roomBounds.maxX, wallHeight / 2, centerZ]} size={[wallThickness, wallHeight, depth]} color={plaster} />
        <RoomBox position={[0, floorSurface + 0.065, roomBounds.minZ + 0.14]} size={[width, 0.13, 0.08]} color={trim} />
        <PictureWindow view={view} material={windowMaterial} />
        <WindowPlant />
        <InteractionRug detailed={shadows} />
        <FoodBowl />
        <DogBed detailed={shadows} />
      </group>
    </>
  );
}
