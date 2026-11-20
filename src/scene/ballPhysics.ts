import { MathUtils, type Vector3 } from "three";
import { ballGroundY, ballStart, dogBed, floorSurface, foodBowl, planFetch, roomBounds, rug, wallThickness, windowPlant, type FloorPoint } from "./roomNavigation";

export const ballPhysicsStep = 1 / 120;
const gravity = 18;
const minimumRebound = 0.62;
const radius = ballStart.radius;
const wallMargin = wallThickness / 2 + radius;
export const ballBounds = {
  minX: roomBounds.minX + wallMargin,
  maxX: roomBounds.maxX - wallMargin,
  minZ: roomBounds.minZ + wallMargin,
  maxZ: roomBounds.maxZ - radius,
};

const wood = { restitution: 0.57, retainedSpeed: 0.75, rollingDrag: 2.45 };
const carpet = { restitution: 0.37, retainedSpeed: 0.64, rollingDrag: 4.2 };

export type BallBody = { position: Vector3; velocity: Vector3; rolling: boolean };

function surfaceAt({ x, z }: FloorPoint) {
  const dx = Math.max(0, Math.abs(x - rug.x) - rug.width / 2 + rug.cornerRadius);
  const dz = Math.max(0, Math.abs(z - rug.z) - rug.depth / 2 + rug.cornerRadius);
  return dx * dx + dz * dz <= rug.cornerRadius ** 2 ? carpet : wood;
}

function bounceSpeed(inward: number, restitution: number) {
  const rebound = -inward * restitution;
  return rebound >= minimumRebound ? rebound : 0;
}

function resolveContact(body: BallBody, x: number, y: number, z: number, depth: number, restitution: number) {
  const { position, velocity } = body;
  position.x += x * depth;
  position.y += y * depth;
  position.z += z * depth;
  const inward = velocity.x * x + velocity.y * y + velocity.z * z;
  if (inward < 0) {
    const impulse = bounceSpeed(inward, restitution) - inward;
    velocity.x += x * impulse;
    velocity.y += y * impulse;
    velocity.z += z * impulse;
  }
  return y > 0.99 && Math.abs(velocity.y) < 0.03;
}

function hitCylinder(body: BallBody, center: FloorPoint, cylinderRadius: number, height: number, restitution: number) {
  const { position } = body;
  const dy = position.y - floorSurface - height;
  if (dy >= radius) return false;
  const dx = position.x - center.x;
  const dz = position.z - center.z;
  const distance = Math.hypot(dx, dz);
  const outside = distance - cylinderRadius;
  if (outside >= radius) return false;

  // Find the normal at the closest point on the side, top, or rounded contact at the rim.
  const horizontal = Math.max(0, outside);
  const vertical = Math.max(0, dy);
  const separation = Math.hypot(horizontal, vertical);
  if (separation >= radius) return false;
  if (separation > 0) {
    const radial = horizontal > 0 ? horizontal / (separation * distance) : 0;
    return resolveContact(body, dx * radial, vertical / separation, dz * radial, radius - separation, restitution);
  }
  if (dy >= outside || distance === 0) return resolveContact(body, 0, 1, 0, radius - dy, restitution);
  return resolveContact(body, dx / distance, 0, dz / distance, radius - outside, restitution);
}

function hitBedRim(body: BallBody) {
  const { position } = body;
  const y = position.y - floorSurface - dogBed.rimHeight;
  const inflatedRim = dogBed.rimThickness + radius;
  if (Math.abs(y) >= inflatedRim) return false;
  const x = position.x - dogBed.x;
  const z = position.z - dogBed.z;
  const radial = Math.hypot(x, z);
  const offset = radial - (dogBed.radius - dogBed.rimThickness);
  const separation = Math.hypot(offset, y);
  if (separation >= inflatedRim) return false;
  if (separation === 0) return resolveContact(body, 0, 1, 0, inflatedRim, 0.29);
  const alongRadius = offset / (radial * separation);
  return resolveContact(body, x * alongRadius, y / separation, z * alongRadius, inflatedRim - separation, 0.29);
}

function limitAxis(body: BallBody, axis: "x" | "z", min: number, max: number) {
  const { position, velocity } = body;
  if (position[axis] < min) {
    position[axis] = min;
    if (velocity[axis] < 0) velocity[axis] *= -0.52;
  } else if (position[axis] > max) {
    position[axis] = max;
    if (velocity[axis] > 0) velocity[axis] *= -0.52;
  }
}

/** Advance a free ball by one fixed step. True means it has come to rest. */
export function stepBall(body: BallBody) {
  const { position, velocity } = body;
  position.addScaledVector(velocity, ballPhysicsStep);
  position.y -= gravity * ballPhysicsStep ** 2 / 2;
  velocity.y -= gravity * ballPhysicsStep;

  let supported = hitCylinder(body, foodBowl, foodBowl.rimRadius, foodBowl.height, 0.4);
  supported = hitCylinder(body, dogBed, dogBed.cushionRadius, dogBed.cushionHeight, 0.24) || supported;
  supported = hitBedRim(body) || supported;
  supported = hitCylinder(body, windowPlant, windowPlant.potRadius, windowPlant.potHeight, 0.38) || supported;
  limitAxis(body, "x", ballBounds.minX, ballBounds.maxX);
  limitAxis(body, "z", ballBounds.minZ, ballBounds.maxZ);

  let material = carpet;
  if (position.y <= ballGroundY) {
    material = surfaceAt(position);
    position.y = ballGroundY;
    if (velocity.y < 0) {
      velocity.y = bounceSpeed(velocity.y, material.restitution);
      if (velocity.y > 0) {
        velocity.x *= material.retainedSpeed;
        velocity.z *= material.retainedSpeed;
      }
    }
    supported = velocity.y === 0;
  }

  body.rolling = supported && Math.abs(velocity.y) < 0.03;
  if (!body.rolling) return false;
  const speed = Math.hypot(velocity.x, velocity.z);
  const deceleration = material.rollingDrag * ballPhysicsStep;
  if (speed <= deceleration) {
    velocity.set(0, 0, 0);
    return true;
  }
  const retainedSpeed = 1 - deceleration / speed;
  velocity.x *= retainedSpeed;
  velocity.z *= retainedSpeed;
  return false;
}

export function predictBallPath(from: Vector3, launchVelocity: Vector3) {
  const body: BallBody = { position: from.clone(), velocity: launchVelocity.clone(), rolling: false };
  const farthest = { x: from.x, z: from.z };
  let maxDistance = 0;
  for (let step = 0; step < 6 / ballPhysicsStep; step++) {
    const settled = stepBall(body);
    const { x, z } = body.position;
    const distance = (x - from.x) ** 2 + (z - from.z) ** 2;
    if (distance > maxDistance) {
      maxDistance = distance;
      farthest.x = x;
      farthest.z = z;
    }
    if (settled) break;
  }
  return { rest: body.position, farthest };
}

export function planBallThrow(dog: FloorPoint, from: Vector3, direction: Vector3, power: number) {
  const speed = MathUtils.lerp(1.45, 5, power);
  const lift = MathUtils.lerp(2.5, 3.65, power);
  const towardCenter = Math.sign(direction.z * from.x - direction.x * from.z) || 1;
  // Try the requested impulse first. Nearby alternatives leave space for the dog next to walls and props.
  for (const angle of [0, towardCenter * 0.3, -towardCenter * 0.3]) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const x = direction.x * cos - direction.z * sin;
    const z = direction.x * sin + direction.z * cos;
    for (const scale of [1, 0.84, 0.69, 0.54, 0.36, 0.25]) {
      const velocity = direction.clone().set(x * speed, lift, z * speed).multiplyScalar(scale);
      const prediction = predictBallPath(from, velocity);
      if (prediction.rest.y === ballGroundY && planFetch(dog, prediction.rest)) return { velocity, prediction };
    }
  }
  return null;
}
