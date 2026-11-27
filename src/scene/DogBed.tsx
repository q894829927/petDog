import { Float32BufferAttribute, LatheGeometry, Vector2, Vector3 } from "three";
import { useWovenFabric } from "./InteractionRug";
import { dogBed, floorSurface } from "./roomNavigation";

const sections = 72;
const rimRadius = dogBed.radius - dogBed.rimThickness;
const bedHeight = dogBed.rimHeight + dogBed.rimThickness;
const fabricTile = 0.34;

// A double turn in the outer profile forms the cord sewn between the side and top panels.
// Each sample gives the offset from the rim center, fraction of bed height and fabric shade.
const rimSection = [
  [0.46, 0, 0.70], [0.67, 0.035, 0.80], [0.92, 0.21, 0.95], [1, 0.44, 1],
  [0.982, 0.55, 1], [0.974, 0.576, 0.76], [1, 0.59, 1.29], [0.999, 0.618, 1.29],
  [0.96, 0.636, 0.88], [0.946, 0.68, 1], [0.80, 0.835, 1], [0.54, 0.938, 1],
  [0.19, 1, 1], [-0.24, 0.99, 1], [-0.64, 0.91, 0.97], [-0.91, 0.75, 0.92],
  [-1, 0.55, 0.84], [-0.97, 0.37, 0.76], [-0.76, 0.16, 0.70],
];
const rimProfile = rimSection.map(([offset, height]) =>
  new Vector2(rimRadius + offset * dogBed.rimThickness, height * bedHeight));
const arcLengths = [0];
for (let i = 1; i < rimProfile.length; i++) {
  arcLengths.push(arcLengths[i - 1] + rimProfile[i].distanceTo(rimProfile[i - 1]));
}

// The low center sits on the cushion collider. The raised edge tucks inside the bolster.
const seatRadius = rimRadius - dogBed.rimThickness;
const cushionProfile = [
  [1.10, 0.045], [1.055, 0.079], [0.97, 0.073], [0.84, 0.045],
  [0.67, 0.015], [0.46, 0.005], [0.24, 0.001], [0, 0],
].map(([fraction, puff]) => new Vector2(fraction * seatRadius, dogBed.cushionHeight + puff));

function smoothFabricNormals(geometry: LatheGeometry) {
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const rows = geometry.parameters.points.length;
  const end = sections * rows;
  const startNormal = new Vector3();
  const endNormal = new Vector3();
  for (let row = 0; row < rows; row++) {
    startNormal.fromBufferAttribute(normals, row);
    endNormal.fromBufferAttribute(normals, end + row);
    startNormal.add(endNormal).normalize();
    normals.setXYZ(row, startNormal.x, startNormal.y, startNormal.z);
    normals.setXYZ(end + row, startNormal.x, startNormal.y, startNormal.z);
  }
}

function shapeBolster(geometry: LatheGeometry) {
  const positions = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const colors = new Float32Array(positions.count * 3);
  const repeats = Math.round(2 * Math.PI * rimRadius / fabricTile);
  for (let sector = 0; sector <= sections; sector++) {
    const angle = sector * 2 * Math.PI / sections;
    const slouch = 0.014 + 0.008 * Math.cos(angle + 0.4) + 0.006 * Math.sin(3 * angle + 1.1);
    for (let row = 0; row < rimProfile.length; row++) {
      const [offset, height, shade] = rimSection[row];
      const vertex = sector * rimProfile.length + row;
      const gather = ((1 + Math.cos(7 * angle + Math.sin(3 * angle) + height * 1.5)) / 2) ** 6;
      const fullness = Math.sin(Math.PI * height);
      const tuck = 0.004 * (1 + Math.cos(3 * angle)) + gather * (0.006 + 0.019 * fullness);
      const radius = rimProfile[row].x - offset * tuck;
      const y = height * (bedHeight - slouch - 0.011 * gather);
      positions.setXYZ(vertex, radius * Math.sin(angle), y, radius * Math.cos(angle));
      uv.setXY(vertex, sector / sections * repeats, arcLengths[row] / fabricTile);
      colors.fill(shade, vertex * 3, vertex * 3 + 3);
    }
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  smoothFabricNormals(geometry);
}

function shapeCushion(geometry: LatheGeometry) {
  const positions = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const colors = new Float32Array(positions.count * 3);
  for (let sector = 0; sector <= sections; sector++) {
    const angle = sector * 2 * Math.PI / sections;
    const gather = ((1 + Math.cos(5 * angle + 0.7 * Math.sin(2 * angle))) / 2) ** 5;
    for (let row = 0; row < cushionProfile.length; row++) {
      const vertex = sector * cushionProfile.length + row;
      const { x: radius, y } = cushionProfile[row];
      const x = radius * Math.sin(angle);
      const z = radius * Math.cos(angle);
      positions.setXYZ(vertex, x, y - 0.02 * gather * (radius / seatRadius) ** 3, z);
      uv.setXY(vertex, x / fabricTile, -z / fabricTile);
      const shade = 1 - 0.34 * (radius / (seatRadius * 1.1)) ** 4;
      colors.fill(shade, vertex * 3, vertex * 3 + 3);
    }
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  smoothFabricNormals(geometry);
  const normals = geometry.getAttribute("normal");
  for (let center = cushionProfile.length - 1; center < normals.count; center += cushionProfile.length) {
    normals.setXYZ(center, 0, 1, 0);
  }
}

export function DogBed({ detailed }: { detailed: boolean }) {
  const fabric = useWovenFabric(detailed);
  return (
    <group name="Dog bed" position={[dogBed.x, floorSurface, dogBed.z]}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[rimProfile, sections]} onUpdate={shapeBolster} />
        <meshStandardMaterial {...fabric} color="#c98f70" roughness={0.97} normalScale={[0.4, 0.4]} vertexColors />
      </mesh>
      <mesh receiveShadow>
        <latheGeometry args={[cushionProfile, sections]} onUpdate={shapeCushion} />
        <meshStandardMaterial {...fabric} color="#ead5b6" roughness={1} normalScale={[0.32, 0.32]} vertexColors />
      </mesh>
    </group>
  );
}
