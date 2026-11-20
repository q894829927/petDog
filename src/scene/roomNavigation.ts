export type FloorPoint = { x: number; z: number };

export const roomBounds = { minX: -6, maxX: 6, minZ: -6.2, maxZ: 3.8 };
export const floorSurface = 0.026;
export const rug = { x: 0, z: 1.26, width: 4.85, depth: 2.85 };
export const dogHome = { x: -0.36, z: 0.72 };
export const foodBowl = { x: -3.15, z: 0.47, radius: 0.37 };
export const dogBed = { x: 3.93, z: -3.67, radius: 0.93 };
export const windowPlant = { x: 5, z: -5.05, radius: 0.45 };
export const ballStart = { x: 1.26, z: 1.67, radius: 0.13 };
export const ballGroundY = floorSurface + ballStart.radius;

// The scaled Akita reaches 1.24 units from its center near the floor.
const dogClearance = 1.25;
const ballClearance = dogClearance + ballStart.radius;
// The running clip reaches 1.36 units near the floor.
const runClearance = 1.38;
const roomProps = [foodBowl, dogBed, windowPlant];
const routeTurns: FloorPoint[] = [{ x: 0, z: -3.72 }, { x: 0, z: -0.35 }, { x: 0, z: 1.64 }];

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

function withinRoom({ x, z }: FloorPoint, margin: number) {
  return x >= roomBounds.minX + margin && x <= roomBounds.maxX - margin &&
    z >= roomBounds.minZ + margin && z <= roomBounds.maxZ - margin;
}

function clearsRoomProps(start: FloorPoint, destination: FloorPoint, clearance: number) {
  return withinRoom(destination, clearance) && roomProps.every((prop) =>
    clearsObstacle(start, destination, prop, prop.radius, clearance),
  );
}

function routeTo(start: FloorPoint, destination: FloorPoint, dogRadius: number, ball?: FloorPoint) {
  const clear = (from: FloorPoint, to: FloorPoint) =>
    clearsRoomProps(from, to, dogRadius) && (!ball || clearsBall(from, to, ball));
  if (clear(start, destination)) return [destination];
  for (const turn of routeTurns) {
    if (clear(start, turn) && clear(turn, destination)) return [turn, destination];
  }
  return null;
}

export type WalkPlan = { route: FloorPoint[]; heading: number };

export function planMeal(start: FloorPoint, ball: FloorPoint): WalkPlan | null {
  // Approach from the open floor, then bring the shallow bowl between the front paws.
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
  for (const stop of [{ x: -0.56, z: 1.6 }, { x: -0.55, z: 1.1 }, dogHome]) {
    const route = routeTo(start, stop, dogClearance, ball);
    if (route) return { route, heading: 0 };
  }
  return null;
}

export function planNap(start: FloorPoint, ball: FloorPoint): WalkPlan | null {
  for (const stop of [{ x: 2.47, z: -1.86 }, { x: 1.86, z: -2.53 }]) {
    // The lying pose extends farther than a normal step.
    if (Math.hypot(stop.x - ball.x, stop.z - ball.z) < 1.49) continue;
    const route = routeTo(start, stop, dogClearance, ball);
    if (route) return { route, heading: -Math.PI / 3 };
  }
  return null;
}

export function hasRoomToRun(position: FloorPoint, ball: FloorPoint) {
  return clearsRoomProps(position, position, runClearance) &&
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

const alternateLandings = [{ x: -2.3, z: -2.15 }, { x: 2.5, z: -1.43 }, { x: 0.8, z: -4.55 }, { x: 2.56, z: 1.84 }];
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
  const outward = Math.atan2(ball.x, ball.z + 1.2);
  for (const heading of [direct, outward, outward - 0.55, outward + 0.55, outward - 1.05, outward + 1.05]) {
    const pickup = fetchStop(ball, heading);
    const outbound = routeTo(start, pickup.approach, runClearance);
    const homeward = routeTo(pickup.approach, deliveryStop.approach, dogClearance);
    if (outbound && homeward) return { pickup, delivery: deliveryStop, outbound, homeward };
  }
  return null;
}

export function chooseBallLanding(start: FloorPoint, from: FloorPoint, aim: FloorPoint): FloorPoint | undefined {
  const margin = ballStart.radius + 0.22;
  const candidates: FloorPoint[] = [...alternateLandings];
  const dx = aim.x - from.x;
  const dz = aim.z - from.z;
  const range = Math.hypot(dx, dz);
  // A blocked aim can shorten the throw or shift it to one side within the same direction.
  for (const fraction of [1, 0.75, 0.5, 0.25]) {
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI / 4;
      const offset = i === 8 ? 0 : 0.42;
      const x = from.x + dx * fraction + offset * Math.sin(angle);
      const z = from.z + dz * fraction + offset * Math.cos(angle);
      candidates.push({
        x: Math.max(roomBounds.minX + margin, Math.min(roomBounds.maxX - margin, x)),
        z: Math.max(roomBounds.minZ + margin, Math.min(roomBounds.maxZ - margin, z)),
      });
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

export function chooseWalkTarget(start: FloorPoint, ball: FloorPoint): FloorPoint | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const distance = 0.75 + Math.random() * 2.4;
    const heading = Math.random() * 2 * Math.PI;
    const target = { x: start.x + Math.sin(heading) * distance, z: start.z + Math.cos(heading) * distance };
    if (!clearsRoomProps(start, target, dogClearance)) continue;
    if (!clearsBall(start, target, ball)) continue;

    return target;
  }
  return null;
}
