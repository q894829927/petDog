import { useCallback, useDeferredValue, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useLoader, type ThreeEvent } from "@react-three/fiber";
import {
  AnimationClip,
  AnimationMixer,
  AnimationUtils,
  LoopOnce,
  MathUtils,
  Mesh,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  type AnimationAction,
  type Group,
  type PerspectiveCamera,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import akitaHighUrl from "../assets/akita-high.glb?url";
import akitaLowUrl from "../assets/akita.glb?url";
import { useGameUI, type MealKind, type PetPart } from "../store/useGameUI";
import { hitPetPart } from "./petTouch";
import {
  ballClearance,
  ballGroundY,
  ballStart,
  chooseWalkTarget,
  clearsBall,
  hasRoomToRun,
  planCall,
  planFetch,
  planMeal,
  rugSurface,
  type FetchPlan,
  type FloorPoint,
  type WalkPlan,
} from "./roomNavigation";

const petClips: Record<PetPart, string> = { head: "Pet", chin: "LiftChin", back: "LookAround" };
const mealClips: Record<MealKind, string> = { feed: "Eat", water: "Drink" };
const dogScale = 2.65;
const turnSpeed = 3.7;
// Root-motion distances measured from Walk_F_RM and Run_F_RM.
const walkSpeed = 0.519 * dogScale;
const runPlaybackRate = 0.7;
const runSpeed = 1.1615 * 1.5 * dogScale * runPlaybackRate;
const biteTime = 0.5;
const loopingClips = ["Idle", "Walk", "Run", "Carry"];

type FetchTrip = {
  plan: FetchPlan;
  launch: FloorPoint;
  takeoffDepth: number;
  phase: "flight" | "chase" | "pickup" | "return" | "drop";
  cancelled: boolean;
  flightTime: number;
  waypoint: number;
};

type Approach = WalkPlan & { kind: MealKind | "call"; waypoint: number };

function touchClip(idle: AnimationClip, name: string, bone: string, axis: Vector3, angleAt: (phase: number) => number) {
  const clip = AnimationUtils.subclip(idle, name, 0, 39, 24);
  const trackIndex = clip.tracks.findIndex(({ name }) => name === bone + ".quaternion");
  const track = clip.tracks[trackIndex] as QuaternionKeyframeTrack | undefined;
  if (!track) throw new Error("Missing Akita rotation track: " + bone);
  const neutral = track.InterpolantFactoryMethodLinear();
  const rotation = new Quaternion();
  const offset = new Quaternion();
  const times = [];
  const values: number[] = [];
  for (let key = 0; key <= 38; key++) {
    const phase = key / 38;
    const time = clip.duration * phase;
    times.push(time);
    rotation.fromArray(neutral.evaluate(time));
    offset.setFromAxisAngle(axis, angleAt(phase));
    rotation.multiply(offset).toArray(values, key * 4);
  }
  clip.tracks[trackIndex] = new QuaternionKeyframeTrack(track.name, times, values);
  return clip;
}

function face(group: Group, heading: number, turnStep: number) {
  const turn = MathUtils.euclideanModulo(heading - group.rotation.y + Math.PI, 2 * Math.PI) - Math.PI;
  group.rotation.y += MathUtils.clamp(turn, -turnStep, turnStep);
  return Math.abs(turn) <= turnStep;
}

function headingTo(start: FloorPoint, target: FloorPoint) {
  return Math.atan2(target.x - start.x, target.z - start.z);
}

function moveToward(position: FloorPoint, target: FloorPoint, distance: number) {
  const remaining = Math.hypot(target.x - position.x, target.z - position.z);
  const fraction = remaining > distance ? distance / remaining : 1;
  position.x = MathUtils.lerp(position.x, target.x, fraction);
  position.z = MathUtils.lerp(position.z, target.z, fraction);
  return fraction === 1;
}

export function AkitaDog({ ball }: { ball: RefObject<Mesh | null> }) {
  const quality = useGameUI((state) => state.quality);
  const modelQuality = useDeferredValue(quality);
  const { scene, animations: assetClips } = useLoader(GLTFLoader, modelQuality === "high" ? akitaHighUrl : akitaLowUrl);
  const animations = useMemo(() => {
    const idle = AnimationClip.findByName(assetClips, "Idle");
    if (!idle) throw new Error("Akita animation missing: Idle");
    const chin = touchClip(idle, "LiftChin", "head", new Vector3(1, 0, 0), (t) => 0.42 * Math.sin(Math.PI * t));
    const brush = touchClip(idle, "Brush", "tail_01", new Vector3(0, 1, 0), (t) => 0.58 * Math.sin(6 * Math.PI * t) * Math.sin(Math.PI * t));
    return [...assetClips, chin, brush];
  }, [assetClips]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const head = useMemo(() => {
    const bone = scene.getObjectByName("head");
    if (!bone) throw new Error("Akita head bone missing");
    return bone;
  }, [scene]);
  const dog = useRef<Group>(null);
  const roaming = useRef<{ target: FloorPoint | null; restTime: number }>({ target: null, restTime: 1.7 });
  const fetch = useRef<FetchTrip | null>(null);
  const approach = useRef<Approach | null>(null);
  const currentAction = useRef<AnimationAction | null>(null);
  const playback = useRef({ name: "Idle", time: 0, interactionSequence: 0 });
  const interaction = useGameUI((state) => state.interaction);
  const trigger = useGameUI((state) => state.trigger);
  const tool = useGameUI((state) => state.tool);
  const lastPetAt = useRef(-Infinity);
  const brushing = useRef<{ pointer: number; startZ: number } | null>(null);

  const play = useCallback((name: string, time = 0) => {
    const clip = AnimationClip.findByName(animations, name);
    if (!clip) throw new Error("Akita animation missing: " + name);

    const action = mixer.clipAction(clip);
    const previous = currentAction.current;
    if (previous === action) return action;

    action.reset();
    action.time = time;
    action.timeScale = name === "Run" ? runPlaybackRate : 1;
    if (!loopingClips.includes(name)) {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.play();
    previous?.crossFadeTo(action, 0.25, false);
    currentAction.current = action;
    return action;
  }, [animations, mixer]);

  const rest = useCallback(() => {
    roaming.current.target = null;
    roaming.current.restTime = MathUtils.randFloat(2.2, 4.4);
    play("Idle");
  }, [play]);

  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
    play(playback.current.name, playback.current.time);

    const onFinished = ({ action }: { action: AnimationAction }) => {
      if (action !== currentAction.current || action.getClip().name === "ReachBall") return;
      const dining = approach.current;
      if (dining && dining.kind !== "call" && action.getClip().name === mealClips[dining.kind]) {
        approach.current = null;
        const ui = useGameUI.getState();
        ui.setBowl(dining.kind, 0);
        ui.setNotice(dining.kind === "feed" ? "团子吃完了狗粮。" : "团子喝完了水。");
      }
      rest();
    };
    mixer.addEventListener("finished", onFinished);
    return () => {
      mixer.removeEventListener("finished", onFinished);
      const action = currentAction.current;
      if (action) {
        playback.current.name = action.getClip().name;
        playback.current.time = action.time;
      }
      mixer.stopAllAction();
      currentAction.current = null;
    };
  }, [mixer, play, rest, scene]);

  useEffect(() => {
    if (!interaction || interaction.sequence === playback.current.interactionSequence) return;
    playback.current.interactionSequence = interaction.sequence;
    const toy = ball.current;
    const group = dog.current;
    if (interaction.kind === "ball") {
      if (fetch.current || !group || !toy) return;
      const plan = planFetch(group.position, toy.position);
      if (!plan) {
        useGameUI.getState().setNotice("团子在等球周围空出一点地方。");
        return;
      }
      const dx = toy.position.x - group.position.x;
      const dz = toy.position.z - group.position.z;
      // Lift a nearby ball away from the muzzle without sending it off the side of the screen.
      const takeoffDepth = Math.max(0, ballClearance - Math.hypot(dx, dz)) * (dz < 0 ? -1 : 1);
      fetch.current = {
        plan,
        launch: { x: toy.position.x, z: toy.position.z },
        takeoffDepth,
        phase: "flight",
        cancelled: false,
        flightTime: 0,
        waypoint: 0,
      };
      approach.current = null;
      roaming.current.target = null;
      play("Idle");
      useGameUI.getState().setNotice("球抛出去了！");
      return;
    }

    const kind = interaction.kind;
    const trip = fetch.current;
    if (kind === "feed" || kind === "water" || kind === "call") {
      if (!group || approach.current?.kind === kind) return;
      const floorBall = trip?.phase === "flight" ? trip.plan.pickup.ball : toy?.position ?? ballStart;
      const ui = useGameUI.getState();
      if (kind === "call") {
        const plan = planCall(group.position, floorBall) ??
          { route: [], heading: headingTo(group.position, { x: 0, z: 7.2 }) };
        approach.current = { ...plan, waypoint: 0, kind };
        ui.setNotice("团子听到了你的呼唤！");
      } else {
        const plan = planMeal(group.position, floorBall);
        if (!plan) {
          ui.setNotice("团子还没找到走到碗边的路。");
          return;
        }
        approach.current = { ...plan, waypoint: 0, kind };
        ui.setBowl(kind, 3);
        ui.setNotice(kind === "feed" ? "狗粮放好了，团子正往碗边走。" : "清水倒好了，团子正往碗边走。");
      }
    } else {
      approach.current = null;
    }

    if (trip?.phase === "flight") {
      trip.cancelled = true;
    } else {
      if (trip && toy) toy.position.y = ballGroundY;
      fetch.current = null;
    }
    roaming.current.target = null;
    if (kind === "call") play("LookAround");
    else if (kind === "feed" || kind === "water") play("Idle");
    else play(kind === "brush" ? "Brush" : petClips[interaction.part]);
  }, [ball, interaction, play]);

  const holdBall = (toy: Mesh) => {
    // Head-bone units for the center of a ball held by the front of the jaw.
    head.localToWorld(toy.position.set(0, -0.0005, -0.00185));
    toy.position.y = Math.max(ballGroundY, toy.position.y);
  };

  const advanceFetch = (trip: FetchTrip, group: Group, toy: Mesh, action: AnimationAction, step: number) => {
    const { pickup, delivery, outbound, homeward } = trip.plan;
    if (trip.phase === "flight") {
      trip.flightTime += step;
      const t = Math.min(1, trip.flightTime / 1.15);
      // Cross the room near the top of the arc and descend clear of the dog.
      const travel = MathUtils.smootherstep(t, 0, 1);
      const lift = 1 - (1 - 2 * t) ** 4;
      const takeoff = trip.takeoffDepth * MathUtils.smoothstep(t, 0, 0.1) * (1 - travel);
      toy.position.set(
        MathUtils.lerp(trip.launch.x, pickup.ball.x, travel),
        ballGroundY + lift * 2.1,
        MathUtils.lerp(trip.launch.z, pickup.ball.z, travel) + takeoff,
      );
      toy.rotation.x += step * 5;
      if (t === 1) {
        if (trip.cancelled) fetch.current = null;
        else trip.phase = "chase";
      }
      return;
    }

    if (trip.phase === "pickup" || trip.phase === "drop") {
      const contacted = action.time >= biteTime;
      if (trip.phase === "pickup" ? contacted : !contacted) holdBall(toy);
      if (trip.phase === "drop" && contacted) toy.position.set(delivery.ball.x, ballGroundY, delivery.ball.z);
      if (action.time < action.getClip().duration) return;

      if (trip.phase === "pickup") {
        trip.phase = "return";
        trip.waypoint = 0;
        play("Carry");
        useGameUI.getState().setNotice("团子叼起球往回走。");
      } else {
        fetch.current = null;
        rest();
        useGameUI.getState().setNotice("团子把球叼回来了！");
      }
      return;
    }

    const carrying = trip.phase === "return";
    const route = carrying ? homeward : outbound;
    const target = route[trip.waypoint];
    const heading = target ? headingTo(group.position, target) : (carrying ? delivery.heading : pickup.heading);
    const aligned = face(group, heading, turnSpeed * step);
    if (target && aligned) {
      const running = !carrying && hasRoomToRun(group.position, pickup.ball);
      const movement = play(carrying ? "Carry" : running ? "Run" : "Walk");
      const speed = running ? runSpeed : walkSpeed;
      if (moveToward(group.position, target, speed * step * movement.getEffectiveWeight())) trip.waypoint++;
    } else if (aligned) {
      trip.phase = carrying ? "drop" : "pickup";
      play("ReachBall");
    } else {
      play(carrying ? "Carry" : target ? "Walk" : "Idle");
    }
    if (carrying) holdBall(toy);
  };

  useFrame(({ camera, size }, delta) => {
    const step = Math.min(delta, 0.1);
    mixer.update(step);

    const group = dog.current;
    const action = currentAction.current;
    if (!group || !action) return;

    const toy = ball.current;
    const trip = fetch.current;
    if (trip && toy) {
      advanceFetch(trip, group, toy, action, step);
      return;
    }

    const visit = approach.current;
    if (visit) {
      const { kind } = visit;
      const target = visit.route[visit.waypoint];
      const heading = target ? headingTo(group.position, target) : visit.heading;
      if (kind === "call" && action.getClip().name === "LookAround" && action.time < 0.55) {
        face(group, headingTo(group.position, { x: 0, z: camera.position.z }), turnSpeed * step);
        return;
      }
      if (target) {
        const movement = play("Walk");
        if (face(group, heading, turnSpeed * step) &&
            moveToward(group.position, target, walkSpeed * step * movement.getEffectiveWeight())) {
          visit.waypoint++;
        }
      } else if (kind === "call") {
        play("Idle");
        if (face(group, heading, turnSpeed * step)) {
          approach.current = null;
          rest();
          roaming.current.restTime = 7;
          useGameUI.getState().setNotice(visit.route.length ? "团子来到你面前，等你摸摸它。" : "团子停下来望着你。");
        }
      } else if (action.getClip().name !== mealClips[kind]) {
        play("Idle");
        if (face(group, heading, turnSpeed * step)) {
          play(mealClips[kind]);
          useGameUI.getState().setNotice(kind === "feed" ? "团子低下头，小口吃了起来。" : "团子正在碗边喝水。");
        }
      } else {
        const consumed = MathUtils.clamp((action.time - 0.85) / (action.getClip().duration - 1.6), 0, 1);
        const portions = Math.ceil(3 * (1 - consumed));
        const ui = useGameUI.getState();
        if (portions !== (ui.bowl?.portions ?? 0)) ui.setBowl(kind, portions);
      }
      return;
    }

    const activity = roaming.current;
    const ballPosition = toy?.position ?? ballStart;
    const clip = action.getClip().name;
    if (clip === "Idle") {
      activity.restTime -= step;
      if (activity.restTime > 0) return;
      const halfFov = MathUtils.degToRad((camera as PerspectiveCamera).fov / 2);
      const viewWidthPerDepth = Math.tan(halfFov) * size.width / size.height;
      activity.target = chooseWalkTarget(group.position, ballPosition, camera.position.z, viewWidthPerDepth);
      if (activity.target) play("Walk");
      else rest();
      return;
    }
    const target = activity.target;
    if (clip !== "Walk" || !target) return;
    if (!clearsBall(group.position, target, ballPosition)) {
      rest();
      return;
    }
    const motionStep = step * action.getEffectiveWeight();
    if (!face(group, headingTo(group.position, target), turnSpeed * motionStep)) return;
    if (moveToward(group.position, target, walkSpeed * motionStep)) {
      activity.target = null;
      if (Math.random() < 0.5) play("Sit");
      else rest();
    }
  });

  const reactToClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (tool === "ball") {
      trigger("ball");
      return;
    }
    if (tool === "brush") return;

    const now = performance.now();
    if (now - lastPetAt.current < 400) return;
    lastPetAt.current = now;
    trigger("pet", hitPetPart(event, head) ?? "head");
  };

  const startBrush = (event: ThreeEvent<PointerEvent>) => {
    if (tool !== "brush" || !dog.current || hitPetPart(event, head) !== "back") return;
    event.stopPropagation();
    const startZ = dog.current.worldToLocal(event.point.clone()).z;
    brushing.current = { pointer: event.pointerId, startZ };
  };

  const brushBack = (event: ThreeEvent<PointerEvent>) => {
    const stroke = brushing.current;
    if (tool !== "brush" || !dog.current || stroke?.pointer !== event.pointerId || hitPetPart(event, head) !== "back") return;
    const z = dog.current.worldToLocal(event.point.clone()).z;
    if (Math.abs(z - stroke.startZ) * dogScale < 0.3) return;
    brushing.current = null;
    trigger("brush");
  };

  const endBrush = (event: ThreeEvent<PointerEvent>) => {
    if (brushing.current?.pointer === event.pointerId) brushing.current = null;
  };

  return (
    <group
      ref={dog}
      position={[0.12, rugSurface, 0.35]}
      rotation={[0, -0.65, 0]}
      scale={dogScale}
      onClick={reactToClick}
      onPointerDown={startBrush}
      onPointerMove={brushBack}
      onPointerUp={endBrush}
      onPointerOut={endBrush}
      onPointerCancel={endBrush}
    >
      <primitive object={scene} />
    </group>
  );
}
