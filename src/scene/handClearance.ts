import { Box3, Matrix4, Mesh, Vector3, type Group, type SkinnedMesh } from "three";

const gridSize = 64;
const clearance = 0.006;

function surface(mesh: Mesh) {
  return {
    mesh,
    indices: mesh.geometry.index!.array,
    vertices: new Float32Array(mesh.geometry.attributes.position.count * 3),
  };
}

type Surface = ReturnType<typeof surface>;

// Bound the depth of each triangle over the cells it touches. With opposite
// signs this gives the dog's outermost surface and the hand's innermost one.
function fillDepth(grid: Float32Array, { indices, vertices }: Surface, bounds: Box3, sign: number) {
  const scaleX = gridSize / (bounds.max.x - bounds.min.x);
  const scaleY = gridSize / (bounds.max.y - bounds.min.y);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = (vertices[a] - bounds.min.x) * scaleX;
    const bx = (vertices[b] - bounds.min.x) * scaleX;
    const cx = (vertices[c] - bounds.min.x) * scaleX;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(gridSize - 1, Math.floor(Math.max(ax, bx, cx)));
    if (minX > maxX) continue;

    const ay = (vertices[a + 1] - bounds.min.y) * scaleY;
    const by = (vertices[b + 1] - bounds.min.y) * scaleY;
    const cy = (vertices[c + 1] - bounds.min.y) * scaleY;
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(gridSize - 1, Math.floor(Math.max(ay, by, cy)));
    if (minY > maxY) continue;

    const az = vertices[a + 2] * sign;
    const bz = vertices[b + 2] * sign;
    const cz = vertices[c + 2] * sign;
    const maxDepth = Math.max(az, bz, cz);
    if (sign > 0 && maxDepth < bounds.min.z - clearance) continue;
    const abX = bx - ax;
    const abY = by - ay;
    const bcX = cx - bx;
    const bcY = cy - by;
    const caX = ax - cx;
    const caY = ay - cy;
    const area = abX * bcY - abY * bcX;
    const winding = Math.sign(area);
    const abRadius = (Math.abs(abX) + Math.abs(abY)) * 0.5;
    const bcRadius = (Math.abs(bcX) + Math.abs(bcY)) * 0.5;
    const caRadius = (Math.abs(caX) + Math.abs(caY)) * 0.5;
    const hasSlope = Math.abs(area) > 1e-8;
    const dzdx = hasSlope ? ((bz - az) * bcY - abY * (cz - bz)) / area : 0;
    const dzdy = hasSlope ? (abX * (cz - bz) - (bz - az) * bcX) / area : 0;
    const depthRadius = (Math.abs(dzdx) + Math.abs(dzdy)) * 0.5;

    for (let row = minY; row <= maxY; row++) {
      const y = row + 0.5;
      for (let column = minX; column <= maxX; column++) {
        const x = column + 0.5;
        // Reject cells lying completely outside any triangle edge.
        if ((abX * (y - ay) - abY * (x - ax)) * winding < -abRadius ||
            (bcX * (y - by) - bcY * (x - bx)) * winding < -bcRadius ||
            (caX * (y - cy) - caY * (x - cx)) * winding < -caRadius) continue;
        const cell = row * gridSize + column;
        const depth = hasSlope ? Math.min(maxDepth, az + dzdx * (x - ax) + dzdy * (y - ay) + depthRadius) : maxDepth;
        if (depth > grid[cell]) grid[cell] = depth;
      }
    }
  }
}

export function createHandClearance(hand: Group, comb: Group) {
  const handSurfaces: Surface[] = [];
  hand.traverse((object) => {
    if (object instanceof Mesh) handSurfaces.push(surface(object));
  });
  const bareHandSurfaces = handSurfaces.filter(({ mesh }) => mesh.parent !== comb);
  let dogSurface: Surface | undefined;
  const handDepth = new Float32Array(gridSize ** 2);
  const dogDepth = new Float32Array(gridSize ** 2);
  const bounds = new Box3();
  const vertex = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const plane = new Matrix4();
  const transform = new Matrix4();

  function project({ mesh, vertices }: Surface, footprint?: Box3) {
    transform.multiplyMatrices(plane, mesh.matrixWorld);
    for (let i = 0; i < vertices.length; i += 3) {
      mesh.getVertexPosition(i / 3, vertex).applyMatrix4(transform).toArray(vertices, i);
      footprint?.expandByPoint(vertex);
    }
  }

  return (dog: SkinnedMesh, outward: Vector3, wristRight: Vector3) => {
    if (dogSurface?.mesh !== dog) dogSurface = surface(dog);
    right.copy(wristRight).addScaledVector(outward, -wristRight.dot(outward)).normalize();
    up.crossVectors(outward, right);
    plane.makeBasis(right, up, outward).transpose();
    bounds.makeEmpty();
    const activeSurfaces = comb.visible ? handSurfaces : bareHandSurfaces;
    for (const skin of activeSurfaces) project(skin, bounds);
    project(dogSurface);

    handDepth.fill(-Infinity);
    dogDepth.fill(-Infinity);
    for (const skin of activeSurfaces) fillDepth(handDepth, skin, bounds, -1);
    fillDepth(dogDepth, dogSurface, bounds, 1);

    let shift = 0;
    for (let cell = 0; cell < dogDepth.length; cell++) {
      shift = Math.max(shift, dogDepth[cell] + handDepth[cell] + clearance);
    }
    return shift;
  };
}
