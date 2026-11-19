export type FloorPoint = { x: number; z: number };

export const rug = { x: 0, z: 0.32, radius: 2.62 };
export const rugSurface = 0.026;
export const foodBowl = { x: -1.82, z: 0.91, radius: 0.37 };
export const dogBed = { x: 1.93, z: -1.85, radius: 1 };
export const ballStart = { x: 1.4, z: 0.9, radius: 0.13 };
export const ballGroundY = rugSurface + ballStart.radius;

// The scaled Akita reaches 1.24 units from its center near the floor.
const dogClearance = 1.25;
// The running clip reaches 1.36 units near the floor.
const runClearance = 1.38;
const walkRadius = rug.radius - dogClearance;

function clearsObstacle(
  start: FloorPoint,
  destination: FloorPoint,
  obstacle: FloorPoint,
  radius: number,
  dogRadius = dogClearance,
) {
  const clearance = radius + dogRadius;
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

function clearsRoomProps(start: FloorPoint, destination: FloorPoint, dogRadius: number) {
  return clearsObstacle(start, destination, foodBowl, foodBowl.radius, dogRadius) &&
    clearsObstacle(start, destination, dogBed, dogBed.radius, dogRadius);
}

function routeTo(start: FloorPoint, destination: FloorPoint, dogRadius: number) {
  if (clearsRoomProps(start, destination, dogRadius)) return [destination];
  if (clearsRoomProps(start, rug, dogRadius) && clearsRoomProps(rug, destination, dogRadius)) return [rug, destination];
  return null;
}

export function hasRoomToRun(position: FloorPoint) {
  return Math.hypot(position.x - rug.x, position.z - rug.z) <= rug.radius - runClearance &&
    clearsRoomProps(position, position, runClearance);
}

function fetchStop(ball: FloorPoint, heading: number) {
  // The muzzle reaches 0.81 units forward at the bottom of ReachBall.
  const reach = 0.81;
  return {
    ball,
    heading,
    approach: { x: ball.x - reach * Math.sin(heading), z: ball.z - reach * Math.cos(heading) },
  };
}

const pickupStops = [
  fetchStop({ x: -1.45, z: -0.5 }, -Math.PI / 2),
  fetchStop({ x: 1.45, z: 0.22 }, Math.PI / 2),
];
const deliveryStop = fetchStop(ballStart, Math.PI / 3);

export type FetchPlan = {
  pickup: ReturnType<typeof fetchStop>;
  delivery: ReturnType<typeof fetchStop>;
  outbound: FloorPoint[];
  homeward: FloorPoint[];
};

export function planFetch(start: FloorPoint, ball: FloorPoint): FetchPlan | null {
  let plan: FetchPlan | null = null;
  let farthest = -1;
  for (const pickup of pickupStops) {
    if (Math.hypot(pickup.ball.x - ball.x, pickup.ball.z - ball.z) < 0.3) continue;
    const distance = Math.hypot(pickup.approach.x - start.x, pickup.approach.z - start.z);
    if (distance <= farthest) continue;
    const outbound = routeTo(start, pickup.approach, runClearance);
    const homeward = routeTo(pickup.approach, deliveryStop.approach, dogClearance);
    if (!outbound || !homeward) continue;
    farthest = distance;
    plan = { pickup, delivery: deliveryStop, outbound, homeward };
  }
  return plan;
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
    if (!clearsRoomProps(start, target, dogClearance)) continue;
    if (!clearsBall(start, target, ball)) continue;

    if (distance >= 0.75) return target;
    nearbyTarget = target;
    farthestNearby = distance;
  }
  return nearbyTarget;
}
