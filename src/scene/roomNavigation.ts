export type FloorPoint = { x: number; z: number };

export const rug = { x: 0, z: 0.32, radius: 2.62 };
export const rugSurface = 0.026;
export const foodBowl = { x: -1.82, z: 0.91, radius: 0.37 };
export const dogBed = { x: 1.93, z: -1.85, radius: 1 };
export const ballStart = { x: 1.4, z: 0.9, radius: 0.13 };
export const ballGroundY = rugSurface + ballStart.radius;

// The scaled Akita reaches 1.24 units from its center near the floor.
const dogClearance = 1.25;
const ballClearance = dogClearance + ballStart.radius;
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

function routeTo(start: FloorPoint, destination: FloorPoint, dogRadius: number, ball?: FloorPoint) {
  const clear = (from: FloorPoint, to: FloorPoint) =>
    clearsRoomProps(from, to, dogRadius) && (!ball || clearsBall(from, to, ball));
  if (clear(start, destination)) return [destination];
  for (const turn of [rug, { x: 0, z: -0.52 }, { x: 0, z: 0.91 }]) {
    if (clear(start, turn) && clear(turn, destination)) return [turn, destination];
  }
  return null;
}

export type WalkPlan = { route: FloorPoint[]; heading: number };

export function planMeal(start: FloorPoint, ball: FloorPoint): WalkPlan | null {
  // Approach the shallow bowl between the front paws, from the center of the rug.
  for (const heading of [-Math.PI / 2, -1.25]) {
    const point = (reach: number) => ({
      x: foodBowl.x - Math.sin(heading) * reach,
      z: foodBowl.z - Math.cos(heading) * reach,
    });
    const stop = point(1.18);
    if (Math.hypot(start.x - stop.x, start.z - stop.z) < 0.02) return { route: [], heading };
    const entry = point(foodBowl.radius + dogClearance + 0.04);
    const route = routeTo(start, entry, dogClearance, ball);
    if (route && clearsBall(entry, stop, ball)) return { route: [...route, stop], heading };
  }
  return null;
}

export function planCall(start: FloorPoint, ball: FloorPoint): WalkPlan | null {
  for (const z of [1.12, 0.74, 0.42]) {
    const stop = { x: 0, z };
    const route = routeTo(start, stop, dogClearance, ball);
    if (route) return { route, heading: 0 };
  }
  return null;
}

export function planNap(start: FloorPoint, ball: FloorPoint): WalkPlan | null {
  for (const stop of [{ x: 0.35, z: -0.17 }, { x: 0, z: -0.58 }]) {
    // The lying pose extends farther than a normal step.
    if (Math.hypot(stop.x - ball.x, stop.z - ball.z) < 1.49) continue;
    const route = routeTo(start, stop, dogClearance, ball);
    if (route) return { route, heading: -Math.PI / 3 };
  }
  return null;
}

export function hasRoomToRun(position: FloorPoint, ball: FloorPoint) {
  return Math.hypot(position.x - rug.x, position.z - rug.z) <= rug.radius - runClearance &&
    clearsRoomProps(position, position, runClearance) &&
    Math.hypot(position.x - ball.x, position.z - ball.z) >= runClearance + ballStart.radius;
}

export function canReclineAt(position: FloorPoint, heading: number, ball: FloorPoint) {
  const x = Math.sin(heading), z = Math.cos(heading);
  const tail = { x: position.x - x * 0.84, z: position.z - z * 0.84 };
  const paws = { x: position.x + x * 0.92, z: position.z + z * 0.92 };
  const spread = 0.43;
  return clearsRoomProps(tail, paws, spread) && clearsRoomProps(paws, tail, spread) &&
    clearsObstacle(tail, paws, ball, ballStart.radius, spread) && clearsObstacle(paws, tail, ball, ballStart.radius, spread);
}

function fetchStop(ball: FloorPoint, heading: number) {
  // The ball's center is 0.945 units forward at contact in ReachBall.
  const reach = 0.945;
  return {
    ball,
    heading,
    approach: { x: ball.x - reach * Math.sin(heading), z: ball.z - reach * Math.cos(heading) },
  };
}

const alternateLandings = [{ x: -1.45, z: -0.5 }, { x: 1.45, z: 0.22 }, { x: 0, z: 1.85 }, { x: 1.48, z: -0.29 }];
const deliveryStop = fetchStop(ballStart, Math.PI / 3);

export type FetchPlan = {
  pickup: ReturnType<typeof fetchStop>;
  delivery: ReturnType<typeof fetchStop>;
  outbound: FloorPoint[];
  homeward: FloorPoint[];
};

export function planFetch(start: FloorPoint, ball: FloorPoint): FetchPlan | null {
  if (!clearsRoomProps(ball, ball, ballStart.radius)) return null;
  const direct = Math.atan2(ball.x - start.x, ball.z - start.z);
  const outward = Math.atan2(ball.x - rug.x, ball.z - rug.z);
  for (const heading of [direct, outward, outward - 0.55, outward + 0.55, outward - 1.05, outward + 1.05]) {
    const pickup = fetchStop(ball, heading);
    if (Math.hypot(pickup.approach.x - rug.x, pickup.approach.z - rug.z) > walkRadius) continue;
    const outbound = routeTo(start, pickup.approach, runClearance);
    const homeward = routeTo(pickup.approach, deliveryStop.approach, dogClearance);
    if (outbound && homeward) return { pickup, delivery: deliveryStop, outbound, homeward };
  }
  return null;
}

export function chooseBallLanding(start: FloorPoint, from: FloorPoint, aim: FloorPoint): FloorPoint | undefined {
  const limit = rug.radius - ballStart.radius - 0.1;
  const candidates: FloorPoint[] = [...alternateLandings];
  const dx = aim.x - from.x;
  const dz = aim.z - from.z;
  const range = Math.hypot(dx, dz);
  // A blocked aim can shorten the throw or shift it to one side within the same direction.
  for (const fraction of [1, 0.75, 0.5, 0.25]) {
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI / 4;
      const offset = i === 8 ? 0 : 0.42;
      const x = from.x + dx * fraction + offset * Math.sin(angle) - rug.x;
      const z = from.z + dz * fraction + offset * Math.cos(angle) - rug.z;
      const scale = Math.min(1, limit / Math.hypot(x, z));
      candidates.push({ x: rug.x + x * scale, z: rug.z + z * scale });
    }
  }
  const distance = (point: FloorPoint) => Math.hypot(point.x - aim.x, point.z - aim.z);
  return candidates.sort((a, b) => distance(a) - distance(b)).find((point) => {
    const x = point.x - from.x;
    const z = point.z - from.z;
    const travel = Math.hypot(x, z);
    return travel >= 0.3 && x * dx + z * dz >= 0.43 * range * travel &&
      Math.hypot(point.x - start.x, point.z - start.z) >= ballClearance && planFetch(start, point);
  });
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
