import assert from "node:assert/strict";
import test from "node:test";
import { Group, PerspectiveCamera, Vector2 } from "three";
import { createHighFiveState, createSitHighFive } from "../src/scene/highFive.ts";

function seatedDog() {
  const dog = new Group(), camera = new PerspectiveCamera(37, 1, 0.1, 50);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const hand = createHighFiveState();
  let taps = 0, lift = 0;
  const motion = createSitHighFive(hand, {
    target: (side, out) => out.set(side === "L" ? 0.3 : -0.3, 0.8, 1),
    apply: (_, amount) => { lift = amount; },
  });
  const action = { paused: false };
  function tick(frames, eligible = true) {
    for (let i = 0; i < frames; i++) {
      lift = 0;
      motion.update(action, dog, camera, { width: 600, height: 600 }, eligible, 1 / 60, () => { taps++; });
      hand.handReady = hand.offered;
    }
  }
  function press() {
    const { x, y } = hand.spots.L;
    hand.pointer = { touch: true, id: 1, ndc: new Vector2(x, y) };
  }
  tick(1);
  return { tick, press, action, hand, taps: () => taps, lift: () => lift };
}

test("a fresh press at the same point needs its own dwell, even between frames", () => {
  const room = seatedDog();
  room.press();
  room.tick(29);
  room.press();
  room.tick(12);
  assert.equal(room.action.paused, false);
  room.tick(150);
  assert.equal(room.taps(), 1);
  assert.equal(room.action.paused, false);
  room.press();
  room.tick(100);
  assert.equal(room.taps(), 2);
});

test("leaving mid-lift lowers the paw without a tap or a stuck seated animation", () => {
  const room = seatedDog();
  room.press();
  room.tick(44);
  assert.ok(room.lift() > 0 && room.lift() < 1);
  room.tick(40, false);
  assert.equal(room.taps(), 0);
  assert.equal(room.lift(), 0);
  assert.equal(room.action.paused, false);
  assert.equal(room.hand.offered, false);
  assert.equal(room.hand.pointer, null);
  room.tick(120);
  assert.equal(room.taps(), 0);
});
