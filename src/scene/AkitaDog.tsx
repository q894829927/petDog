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
  SkinnedMesh,
  Vector2,
  Vector3,
  type AnimationAction,
  type Group,
  type PerspectiveCamera,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import akitaHighUrl from "../assets/akita-high.glb?url";
import akitaLowUrl from "../assets/akita.glb?url";
import { recordPetAction, useCloudPet } from "../cloud/useCloudPet";
import { petMessages, useGameUI, type Interaction, type MealKind, type PetTarget } from "../store/useGameUI";
import { createPetReactions } from "./petReactions";
import { hitPetTarget } from "./petTouch";
import { createReclinedPose, reclineClips, rollIntoRecline, rollOutOfRecline } from "./reclinedPose";
import type { HandContact, HandGesture } from "./PlayerHand";
import {
  ballClearance,
  ballGroundY,
  ballStart,
  canReclineAt,
  chooseWalkTarget,
  clearsBall,
  hasRoomToRun,
  planCall,
  planFetch,
  planMeal,
  planNap,
  rugSurface,
  type FetchPlan,
  type FloorPoint,
  type WalkPlan,
} from "./roomNavigation";

const mealClips: Record<MealKind, string> = { feed: "Eat", water: "Drink" };
const dogScale = 2.65;
const turnSpeed = 3.7;
// Root-motion distances measured from Walk_F_RM and Run_F_RM.
const walkSpeed = 0.519 * dogScale;
const runPlaybackRate = 0.7;
const runSpeed = 1.1615 * 1.5 * dogScale * runPlaybackRate;
const biteTime = 0.5;
const petReactionCooldown = 400;
const petRegionDwell = 90;
const petRegionTravel = 8;
const brushStrokeLength = 0.3;
const pokeTapLimit = 450;
const pokeDragLimit = 7;
const loopingClips = ["Idle", "Walk", "Run", "Carry", "Nap", "Recline"];

type FetchTrip = {
  plan: FetchPlan;
  owner: number | null;
  launch: FloorPoint;
  takeoffDepth: number;
  phase: "flight" | "chase" | "pickup" | "return" | "drop";
  cancelled: boolean;
  flightTime: number;
  waypoint: number;
};

type Approach = WalkPlan & { kind: MealKind | "call" | "nap"; waypoint: number; owner: number | null };

type PetStroke = {
  pointer: number;
  target: PetTarget;
  next: { target: PetTarget; screenPoint: Vector2; since: number } | null;
  rub: { seconds: number; distance: number; previousPoint: Vector2 | null };
};

type PendingInteraction = { interaction: Interaction; owner: number | null };

type Recline = {
  phase: "turn" | "down" | "hold" | "up";
  heading: number;
  holdFor: number;
  pending: PendingInteraction | null;
};

function isRubArea(gesture: HandGesture | undefined) {
  return gesture === "chest" || gesture === "flank";
}

function samePetTarget(a: PetTarget, b: PetTarget | undefined) {
  return a.part === b?.part && a.side === b.side && a.hind === b.hind;
}

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

export function AkitaDog({ ball, handContact }: { ball: RefObject<Mesh | null>; handContact: RefObject<HandContact | null> }) {
  const quality = useGameUI((state) => state.quality);
  const modelQuality = useDeferredValue(quality);
  const { scene, animations: assetClips } = useLoader(GLTFLoader, modelQuality === "high" ? akitaHighUrl : akitaLowUrl);
  const animations = useMemo(() => {
    const idle = AnimationClip.findByName(assetClips, "Idle");
    if (!idle) throw new Error("Akita animation missing: Idle");
    const chin = touchClip(idle, "LiftChin", "head", new Vector3(1, 0, 0), (t) => 0.42 * Math.sin(Math.PI * t));
    const brush = touchClip(idle, "Brush", "tail_01", new Vector3(0, 1, 0), (t) => 0.58 * Math.sin(6 * Math.PI * t) * Math.sin(Math.PI * t));
    return [...assetClips, chin, brush, ...reclineClips(assetClips)];
  }, [assetClips]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const reactions = useMemo(() => {
    const lookAround = AnimationClip.findByName(assetClips, "LookAround");
    if (!lookAround) throw new Error("Akita animation missing: LookAround");
    return createPetReactions(mixer, lookAround);
  }, [assetClips, mixer]);
  const head = useMemo(() => {
    const bone = scene.getObjectByName("head");
    if (!bone) throw new Error("Akita head bone missing");
    return bone;
  }, [scene]);
  const skin = useMemo(() => {
    const mesh = scene.getObjectByProperty("isSkinnedMesh", true);
    if (!(mesh instanceof SkinnedMesh)) throw new Error("Akita skinned mesh missing");
    return mesh;
  }, [scene]);
  const dog = useRef<Group>(null);
  const rig = useRef<Group>(null);
  const recline = useRef<Recline | null>(null);
  const poseReclined = useMemo(createReclinedPose, []);
  const roaming = useRef({ target: null as FloorPoint | null, restTime: 1.7, activeTime: 0, napAfter: 24 });
  const fetch = useRef<FetchTrip | null>(null);
  const approach = useRef<Approach | null>(null);
  const nap = useRef<{
    timeLeft: number;
    pending: PendingInteraction | null;
    owner: number | null;
  } | null>(null);
  const currentAction = useRef<AnimationAction | null>(null);
  const playback = useRef({ name: "Idle", time: 0, interactionSequence: 0 });
  const interaction = useGameUI((state) => state.interaction);
  const trigger = useGameUI((state) => state.trigger);
  const tool = useGameUI((state) => state.tool);
  const lastPetAt = useRef(-Infinity);
  const petStroke = useRef<PetStroke | null>(null);
  const brushing = useRef<{ pointer: number; startZ: number } | null>(null);
  const rearTap = useRef<{ pointer: number; x: number; y: number; startedAt: number } | null>(null);
  const pokeCue = useRef<{ target: PetTarget; time: number } | null>(null);

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

  const reactToPet = useCallback((target: PetTarget) => {
    if (recline.current) {
      reactions.play(target);
      return;
    }
    const base = currentAction.current?.getClip().name;
    const authored = target.part === "head" ? "Pet" : target.part === "chin" ? "LiftChin" : null;
    if (authored && base !== "Sit") {
      reactions.fade();
      play(authored);
      return;
    }
    if (base !== "Sit" && base !== "Idle") play("Idle");
    roaming.current.restTime = Math.max(roaming.current.restTime, 1.8);
    reactions.play(target);
  }, [play, reactions]);

  useEffect(() => {
    handContact.current = null;
    scene.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
    play(playback.current.name, playback.current.time);

    const onFinished = ({ action }: { action: AnimationAction }) => {
      if (action !== currentAction.current || action.getClip().name === "ReachBall" || nap.current || recline.current) return;
      const dining = approach.current;
      if (dining && (dining.kind === "feed" || dining.kind === "water") &&
          action.getClip().name === mealClips[dining.kind]) {
        approach.current = null;
        const ui = useGameUI.getState();
        ui.setBowl(dining.kind, 0);
        ui.setNotice(dining.kind === "feed" ? "团子吃完了狗粮。" : "团子喝完了水。");
        recordPetAction(dining.kind === "feed" ? "feed" : "drink", dining.owner);
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
  }, [handContact, mixer, play, rest, scene]);

  const startInteraction = useCallback((interaction: Interaction, owner: number | null) => {
    const toy = ball.current;
    const group = dog.current;
    const { pet } = useCloudPet.getState();
    pokeCue.current = null;
    if (interaction.kind !== "pet") reactions.fade();
    if (interaction.kind === "ball") {
      if (fetch.current || !group || !toy) return;
      if (pet && pet.energy < 8) {
        useGameUI.getState().setNotice("团子有点累，休息一会儿再玩球。");
        return;
      }
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
        owner,
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
        approach.current = { ...plan, waypoint: 0, kind, owner };
        ui.setNotice("团子听到了你的呼唤！");
      } else {
        const plan = planMeal(group.position, floorBall);
        if (!plan) {
          ui.setNotice("团子还没找到走到碗边的路。");
          return;
        }
        approach.current = { ...plan, waypoint: 0, kind, owner };
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
    if (kind === "poke") {
      if (currentAction.current?.getClip().name !== "Sit") play("Idle");
      roaming.current.restTime = 1.8;
      pokeCue.current = { target: interaction, time: 0.21 };
    } else if (kind === "call") play("LookAround");
    else if (kind === "feed" || kind === "water") play("Idle");
    else {
      if (kind === "brush") play("Brush");
      else reactToPet(interaction);
      recordPetAction(kind, owner);
    }
  }, [ball, play, reactions, reactToPet]);

  useEffect(() => {
    if (!interaction || interaction.sequence === playback.current.interactionSequence) return;
    playback.current.interactionSequence = interaction.sequence;
    if (interaction.kind !== "pet") petStroke.current = null;
    const owner = useCloudPet.getState().accountId;
    const lying = recline.current;
    if (lying) {
      if (interaction.kind === "pet" && lying.phase !== "up") {
        reactToPet(interaction);
        recordPetAction("pet", owner);
      } else {
        lying.pending = { interaction, owner };
      }
      return;
    }
    const sleeping = nap.current;
    if (sleeping) {
      sleeping.pending = { interaction, owner };
      if (currentAction.current?.getClip().name === "Nap") play("NapUp");
      useGameUI.getState().setNotice("团子醒了，正在起身。");
    } else {
      startInteraction(interaction, owner);
    }
  }, [interaction, play, reactToPet, startInteraction]);

  const advanceRecline = (lying: Recline, group: Group, body: Group, action: AnimationAction, step: number, petting: boolean) => {
    const finished = action.time >= action.getClip().duration;
    if ((lying.phase === "turn" && lying.pending) || (lying.phase === "up" && finished)) {
      recline.current = null;
      body.position.set(0, 0, 0);
      body.rotation.z = 0;
      rest();
      body.updateMatrixWorld(true);
      skin.computeBoundingSphere();
      if (lying.pending) startInteraction(lying.pending.interaction, lying.pending.owner);
      return;
    }

    switch (lying.phase) {
      case "turn":
        poseReclined(body, skin, 0);
        if (face(group, lying.heading, turnSpeed * step)) {
          lying.phase = "down";
          play("ReclineDown");
        }
        break;
      case "down":
        poseReclined(body, skin, rollIntoRecline(action.time, action.getClip().duration));
        if (finished) {
          lying.phase = "hold";
          play("Recline");
          body.updateMatrixWorld(true);
          skin.computeBoundingSphere();
          useGameUI.getState().setNotice("团子侧躺下来，把肚皮露给你。");
        }
        break;
      case "hold":
        poseReclined(body, skin, 1);
        if (!petting) lying.holdFor -= step;
        if (lying.pending || lying.holdFor <= 0) {
          reactions.fade();
          lying.phase = "up";
          play("ReclineUp");
        }
        break;
      case "up":
        poseReclined(body, skin, rollOutOfRecline(action.time));
        break;
    }
  };

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
        recordPetAction("play", trip.owner);
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
    const clip = action.getClip().name;
    const cue = pokeCue.current;
    if (cue) {
      if (tool !== "pet" || handContact.current?.gesture !== "poke") {
        pokeCue.current = null;
      } else {
        cue.time -= step;
        if (cue.time <= 0) {
          reactions.play(cue.target);
          useGameUI.getState().setNotice(petMessages.poke);
          pokeCue.current = null;
        }
      }
    }
    const sleeping = nap.current;
    if (sleeping) {
      const finished = action.time >= action.getClip().duration;
      if (clip === "NapDown" && finished) {
        play(sleeping.pending ? "NapUp" : "Nap");
        if (!sleeping.pending) {
          useGameUI.getState().setNotice("团子在狗窝旁打起了盹。");
          recordPetAction("sleep", sleeping.owner);
        }
      } else if (clip === "Nap") {
        sleeping.timeLeft -= step;
        if (sleeping.timeLeft <= 0) play("NapUp");
      } else if (clip === "NapUp" && finished) {
        nap.current = null;
        recordPetAction("wake", sleeping.owner);
        rest();
        if (sleeping.pending) startInteraction(sleeping.pending.interaction, sleeping.pending.owner);
      }
      return;
    }

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
          recordPetAction("call", visit.owner);
        }
      } else if (kind === "nap") {
        play("Idle");
        if (face(group, heading, turnSpeed * step)) {
          approach.current = null;
          nap.current = { timeLeft: MathUtils.randFloat(7, 11), pending: null, owner: visit.owner };
          play("NapDown");
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

    const touch = handContact.current;
    const stroke = petStroke.current;
    const petting = tool === "pet" && touch?.pressed === true && stroke?.pointer === touch.pointer;
    if (stroke) {
      const { rub } = stroke;
      if (petting && !recline.current && isRubArea(touch.gesture)) {
        rub.seconds += step;
        if (rub.previousPoint) {
          const x = (touch.screenPoint.x - rub.previousPoint.x) * size.width / 2;
          const y = (touch.screenPoint.y - rub.previousPoint.y) * size.height / 2;
          rub.distance += Math.min(20, Math.hypot(x, y));
        }
        rub.previousPoint = touch.screenPoint;
      } else {
        rub.previousPoint = null;
      }
    }
    const next = stroke?.next;
    if (petting && next && next.target.part === touch.gesture) {
      const now = performance.now();
      const travelX = (touch.screenPoint.x - next.screenPoint.x) * size.width * 0.5;
      const travelY = (touch.screenPoint.y - next.screenPoint.y) * size.height * 0.5;
      if (now - next.since >= petRegionDwell && now - lastPetAt.current >= petReactionCooldown &&
          Math.hypot(travelX, travelY) >= (touch.touch ? 5 : petRegionTravel)) {
        stroke.target = next.target;
        stroke.next = null;
        lastPetAt.current = now;
        // One press records one interaction. Further strokes only change the visible reaction.
        reactToPet(next.target);
        useGameUI.getState().setNotice(petMessages[next.target.part]);
      }
    }

    if (recline.current && rig.current) {
      advanceRecline(recline.current, group, rig.current, action, step, petting);
      return;
    }

    const grooming = tool === "brush" && touch?.pressed && touch.gesture === "brush";
    if (grooming && clip === "Walk") {
      rest();
      return;
    }
    const activity = roaming.current;
    const ballPosition = toy?.position ?? ballStart;
    if (clip === "Idle" || clip === "Walk" || clip === "Sit") activity.activeTime += step;
    if (clip === "Idle") {
      if (petting || grooming) return;
      activity.restTime -= step;
      if (activity.restTime > 0) return;
      const { accountId: owner, pet } = useCloudPet.getState();
      const napAfter = pet?.sleeping ? 0 : pet && pet.energy < 25 ? 8 : activity.napAfter;
      if (activity.activeTime >= napAfter) {
        activity.activeTime = 0;
        activity.napAfter = MathUtils.randFloat(24, 38);
        const plan = planNap(group.position, ballPosition);
        if (plan) {
          approach.current = { ...plan, kind: "nap", waypoint: 0, owner };
          useGameUI.getState().setNotice("团子准备去狗窝旁休息。");
          return;
        }
      }
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

  const throwOnClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (tool === "ball") trigger("ball");
  };

  const placeHand = (event: ThreeEvent<PointerEvent>, gesture: HandGesture, pressed: boolean) => {
    const { object, face, barycoord } = event;
    if (!dog.current || !(object instanceof SkinnedMesh) || !face || !barycoord) return;
    const previous = handContact.current;
    const samePointer = previous?.pointer === event.pointerId;
    const now = performance.now();
    const startedAt = event.type === "pointerdown" || gesture === "poke" ? now : samePointer ? previous.startedAt : null;
    handContact.current = {
      dog: dog.current,
      mesh: object,
      vertices: [face.a, face.b, face.c],
      weights: barycoord,
      pointer: event.pointerId,
      touch: event.pointerType === "touch",
      screenPoint: event.pointer.clone(),
      gesture,
      startedAt,
      pressed,
      visibleUntil: gesture === "poke" ? now + 540 : Infinity,
    };
  };

  const startPetStroke = (pointer: number, target: PetTarget, now: number) => {
    if (now - lastPetAt.current < petReactionCooldown) return;
    lastPetAt.current = now;
    petStroke.current = { pointer, target, next: null, rub: { seconds: 0, distance: 0, previousPoint: null } };
    trigger("pet", target);
  };

  const pointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!event.isPrimary || event.button !== 0 || tool === "ball") return;
    petStroke.current = null;
    brushing.current = null;
    rearTap.current = null;
    const canPoke = tool === "pet" && !nap.current && !recline.current;
    const target = hitPetTarget(event, canPoke ? "tap" : "stroke");
    if (!target || (tool === "brush" && target.part !== "back")) return;
    event.stopPropagation();
    if (tool === "pet") {
      const now = performance.now();
      if (target.part === "poke") {
        rearTap.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startedAt: now };
      } else {
        placeHand(event, target.part, true);
        startPetStroke(event.pointerId, target, now);
      }
      return;
    }
    placeHand(event, "brush", true);
    if (!dog.current) return;
    const startZ = dog.current.worldToLocal(event.point.clone()).z;
    brushing.current = { pointer: event.pointerId, startZ };
  };

  const pointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!event.isPrimary || tool === "ball") return;
    const picked = hitPetTarget(event);
    const part = picked?.part;
    const onBack = tool === "brush" && part === "back";
    const pressed = (event.buttons & 1) !== 0;
    const target = handContact.current;
    const now = performance.now();
    if (target?.gesture === "poke" && now < target.visibleUntil) return;
    const tapping = rearTap.current;
    if (tapping?.pointer === event.pointerId && pressed) {
      if (Math.hypot(event.clientX - tapping.x, event.clientY - tapping.y) <= pokeDragLimit) return;
      rearTap.current = null;
      if (picked && tool === "pet") startPetStroke(event.pointerId, picked, now);
    }
    if (part && (tool === "pet" || onBack) && (event.pointerType === "mouse" || pressed)) {
      placeHand(event, tool === "brush" ? "brush" : part, pressed);
    } else if ((!part || (tool === "brush" && !onBack)) && target?.pointer === event.pointerId) {
      handContact.current = null;
    }
    const petting = petStroke.current;
    if (tool === "pet" && petting?.pointer === event.pointerId) {
      if (!pressed || !picked || samePetTarget(picked, petting.target)) {
        petting.next = null;
      } else if (!samePetTarget(picked, petting.next?.target)) {
        petting.next = { target: picked, screenPoint: event.pointer.clone(), since: now };
      }
    }

    const stroke = brushing.current;
    if (stroke?.pointer !== event.pointerId) return;
    if (!pressed || !onBack || !dog.current) {
      brushing.current = null;
      return;
    }
    const z = dog.current.worldToLocal(event.point.clone()).z;
    if ((stroke.startZ - z) * dogScale < brushStrokeLength) return;
    brushing.current = null;
    trigger("brush", { part: "back" });
  };

  const finishPointer = (event: ThreeEvent<PointerEvent>) => {
    const tapping = rearTap.current;
    if (tapping?.pointer === event.pointerId) {
      rearTap.current = null;
      if (event.type === "pointerup" && tool === "pet") {
        const picked = hitPetTarget(event, "tap");
        const now = performance.now();
        if (picked?.part === "poke" && now - tapping.startedAt <= pokeTapLimit &&
            Math.hypot(event.clientX - tapping.x, event.clientY - tapping.y) <= pokeDragLimit) {
          placeHand(event, "poke", false);
          trigger("poke", picked);
          return;
        }
        const normalTouch = hitPetTarget(event);
        if (normalTouch) {
          placeHand(event, normalTouch.part, false);
          startPetStroke(event.pointerId, normalTouch, now);
        }
      }
    }
    const target = handContact.current;
    const petting = petStroke.current;
    if (petting?.pointer === event.pointerId) {
      if (event.type === "pointerout") petting.next = null;
      else petStroke.current = null;
      const group = dog.current;
      const base = currentAction.current?.getClip().name;
      if (event.type === "pointerup" && tool === "pet" && !recline.current && !nap.current && !approach.current && !fetch.current &&
          group && (base === "Idle" || base === "Sit") && isRubArea(target?.gesture) &&
          petting.rub.seconds >= 1.15 && petting.rub.distance >= (target?.touch ? 14 : 22)) {
        const facingCamera = headingTo(group.position, event.camera.position);
        const headings = [facingCamera + Math.PI / 2, facingCamera + 1.22, facingCamera + 1.91];
        const heading = headings.find((angle) => canReclineAt(group.position, angle, ball.current?.position ?? ballStart));
        if (heading !== undefined) {
          recline.current = { phase: "turn", heading, holdFor: 6, pending: null };
          reactions.fade();
          if (face(group, heading, 0)) {
            recline.current.phase = "down";
            play("ReclineDown");
          } else {
            play("Walk");
          }
        }
      }
    }
    if (brushing.current?.pointer === event.pointerId) brushing.current = null;
    if (target?.pointer === event.pointerId && event.type !== "pointerup" && target.visibleUntil === Infinity) {
      handContact.current = null;
    }
  };

  return (
    <group
      name="Akita"
      ref={dog}
      position={[0.12, rugSurface, 0.35]}
      rotation={[0, -0.65, 0]}
      scale={dogScale}
      onClick={throwOnClick}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishPointer}
      onPointerOut={finishPointer}
      onPointerCancel={finishPointer}
    >
      <group name="Akita pose" ref={rig}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
