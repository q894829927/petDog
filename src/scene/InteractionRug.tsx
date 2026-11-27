import { useLayoutEffect } from "react";
import { useLoader } from "@react-three/fiber";
import { Color, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2 } from "three";
import weaveUrl from "../assets/basketweave.webp?url";
import weaveNormalUrl from "../assets/basketweave-normal.webp?url";
import { floorSurface, rug } from "./roomNavigation";

export function useWovenFabric(detailed: boolean) {
  const map = useLoader(TextureLoader, weaveUrl);
  const detail = useLoader(TextureLoader, detailed ? weaveNormalUrl : weaveUrl);
  const normalMap = detailed ? detail : null;
  useLayoutEffect(() => {
    map.colorSpace = SRGBColorSpace;
    for (const texture of [map, normalMap]) {
      if (texture && texture.wrapS !== RepeatWrapping) {
        texture.wrapS = texture.wrapT = RepeatWrapping;
        // Six basket-weave cells span the half-size tile.
        texture.repeat.set(2, 2);
        texture.anisotropy = 4;
        texture.needsUpdate = true;
      }
    }
  }, [map, normalMap]);
  return { map, normalMap };
}

// Each loop follows the same rounded corners. The binding runs along the hem
// while the basket weave on the face runs straight across the rug.
function rugLoop(inset: number) {
  const points: Vector2[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const right = corner === 0 || corner === 3;
    const top = corner < 2;
    const x = (right ? 1 : -1) * (rug.width / 2 - rug.cornerRadius);
    const y = (top ? 1 : -1) * (rug.depth / 2 - rug.cornerRadius);
    for (let step = 0; step <= 10; step++) {
      const angle = (corner + step / 10) * Math.PI / 2;
      const radius = rug.cornerRadius - inset;
      points.push(new Vector2(x + radius * Math.cos(angle), y + radius * Math.sin(angle)));
    }
  }
  return [...points, points[0]];
}

function makeRug() {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  function vertex(x: number, y: number, u: number, v: number, color: Color) {
    positions.push(x, y, 0);
    normals.push(0, 0, 1);
    uvs.push(u, v);
    colors.push(color.r, color.g, color.b);
  }

  const outer = rugLoop(0);
  const distances = [0];
  for (let i = 1; i < outer.length; i++) distances.push(distances[i - 1] + outer[i].distanceTo(outer[i - 1]));
  const perimeter = distances[distances.length - 1];
  const repeats = Math.round(perimeter / 0.52);
  const binding = [
    { inset: 0, tint: "#aa9272" },
    { inset: 0.009, tint: "#cfb895" },
    { inset: 0.043, tint: "#d3bf9e" },
    { inset: 0.051, tint: "#a79174" },
  ];
  for (const [row, { inset, tint }] of binding.entries()) {
    const color = new Color(tint);
    rugLoop(inset).forEach((point, i) => {
      vertex(point.x, point.y, distances[i] / perimeter * repeats, inset / 0.42, color);
      if (row === 0 || i === 0) return;
      const inner = row * outer.length + i;
      const edge = inner - outer.length;
      indices.push(edge - 1, edge, inner, edge - 1, inner, inner - 1);
    });
  }

  const face = new Color("#f0e4ce");
  const center = positions.length / 3;
  vertex(0, 0, 0, 0, face);
  rugLoop(binding[binding.length - 1].inset).forEach((point, i) => {
    vertex(point.x, point.y, point.x / 0.92, point.y / 0.92, face);
    if (i > 0) indices.push(center, center + i, center + i + 1);
  });
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    uvs: new Float32Array(uvs), colors: new Float32Array(colors), indices: new Uint16Array(indices),
  };
}

const geometry = makeRug();

export function InteractionRug({ detailed }: { detailed: boolean }) {
  const fabric = useWovenFabric(detailed);
  return (
    <mesh name="Interaction rug" position={[rug.x, floorSurface, rug.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="attributes-normal" args={[geometry.normals, 3]} />
        <bufferAttribute attach="attributes-color" args={[geometry.colors, 3]} />
        <bufferAttribute attach="attributes-uv" args={[geometry.uvs, 2]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <meshStandardMaterial {...fabric} vertexColors roughness={0.98} normalScale={[0.55, 0.55]}
        polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}
