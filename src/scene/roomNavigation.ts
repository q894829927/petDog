export type FloorPoint = { x: number; z: number };

export const rug = { x: 0, z: 0.32, radius: 2.62 };
export const foodBowl = { x: -1.82, z: 0.91, radius: 0.37 };
export const dogBed = { x: 1.93, z: -1.85, radius: 1 };
export const ballStart = { x: 1.65, z: 0.85, radius: 0.19 };

// The scaled Akita reaches 1.24 units from its center near the floor.
const dogClearance = 1.25;
const walkRadius = rug.radius - dogClearance;

function clearsObstacle(
  start: FloorPoint,
  destination: FloorPoint,
  obstacle: FloorPoint,
  radius: number,
) {
  const clearance = radius + dogClearance;
  if (Math.hypot(destination.x - obstacle.x, destination.z - obstacle.z) < clearance) return false;

  const dx = destination.x - start.x;
  const dz = destination.z - start.z;
  const toObstacleX = obstacle.x - start.x;
  const toObstacleZ = obstacle.z - start.z;
  const projection = toObstacleX * dx + toObstacleZ * dz;
  // A ball that has rolled into the clearance still leaves room to walk away.
  if (projection <= 0) return true;
  const closest = Math.min(1, projection / (dx * dx + dz * dz));
  return Math.hypot(toObstacleX - closest * dx, toObstacleZ - closest * dz) >= clearance;
}

export function clearsBall(start: FloorPoint, destination: FloorPoint, ball: FloorPoint) {
  return clearsObstacle(start, destination, ball, ballStart.radius);
}

export function chooseWalkTarget(
  start: FloorPoint,
  ball: FloorPoint,
  cameraZ: number,
  viewWidthPerDepth: number,
): FloorPoint | null {
  const backZ = rug.z - walkRadius;
  let nearbyTarget: FloorPoint | null = null;
  let farthestNearby = 0.4;
  for (let attempt = 0; attempt < 40; attempt++) {
    const z = backZ + Math.random() * (0.74 - backZ);
    const rugHalfWidth = Math.sqrt(walkRadius ** 2 - (z - rug.z) ** 2);
    // Keep the full dog in the fixed camera's view as it turns.
    const viewHalfWidth = (cameraZ - z) * viewWidthPerDepth - 1.35;
    const halfWidth = Math.min(rugHalfWidth, viewHalfWidth);
    if (halfWidth <= 0) continue;

    const target = { x: rug.x + (2 * Math.random() - 1) * halfWidth, z };
    const distance = Math.hypot(target.x - start.x, target.z - start.z);
    if (distance <= farthestNearby) continue;
    if (!clearsObstacle(start, target, foodBowl, foodBowl.radius)) continue;
    if (!clearsObstacle(start, target, dogBed, dogBed.radius)) continue;
    if (!clearsBall(start, target, ball)) continue;

    if (distance >= 0.75) return target;
    nearbyTarget = target;
    farthestNearby = distance;
  }
  return nearbyTarget;
}
