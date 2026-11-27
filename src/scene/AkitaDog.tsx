import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  AnimationClip,
  AnimationMixer,
  AnimationUtils,
  LoopOnce,
  LoopPingPong,
  MathUtils,
  Mesh,
  Quaternion,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  Vector2,
  Vector3,
  type AnimationAction,
  type Group,
} from "three";
import { recordPetAction, useCloudPet } from "../cloud/useCloudPet";
import { petMessages, useGameUI, type Interaction, type MealKind, type PetTarget } from "../store/useGameUI";
import { createPetReactions, isTailPart } from "./petReactions";
import type { DogShadowAnchors } from "./GroundContactShadows";
import { hitPetTarget } from "./petTouch";
import { createReclinedPose, reclineClips, rollIntoRecline, rollOutOfRecline } from "./reclinedPose";
import type { HandContact, HandGesture } from "./PlayerHand";
import { ballFloorPoint, dropBall, nudgeBall, type BallState } from "./TennisBall";
import { pulseOnTouch } from "./touchHaptics";
import { useAkitaModel } from "./useAkitaModel";
import {
  ballGroundY,
  canReclineAt,
  chooseWalkTarget,
  clearsBall,
  dogHome,
  floorSurface,
  hasRoomToRun,
  planCall,
  planFetch,
  planMeal,
  planNap,
  planPlayInvitation,
  planShortStep,
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
const rearTapLimit = 450;
const rearDragLimit = 7;
const loopingClips = ["Idle", "Walk", "Run", "Carry", "Nap", "Recline"];

type FetchTrip = {
  plan: FetchPlan;
  source: "throw" | "invitation";
  owner: number | null;
  phase: "chase" | "pickup" | "return" | "drop";
  waypoint: number;
};

type PlayOffer = { phase: "wait"; timeLeft: number } | { phase: "stepBack"; target: FloorPoint };

type Approach = WalkPlan & { kind: MealKind | "call" | "nap"; waypoint: number; owner: number | null };

type PetStroke = {
  pointer: number;
  target: PetTarget;
  next: { target: PetTarget; screenPoint: Vector2; since: number } | null;
  rub: { seconds: number; distance: number; previousPoint: Vector2 | null };
};

type PendingInteraction = { interaction: Interaction; owner: number | null };

type RearReaction = { target: PetTarget; phase: "contact" | "recoil" | "turn"; time: number };
type RearTap = { contact: HandContact; target: PetTarget; x: number; y: number; startedAt: number };

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

function createIdleGrounding(mesh: SkinnedMesh) {
  const positions = mesh.geometry.attributes.position;
  const soles: number[] = [];
  // Sample the sole vertices near the floor in the Akita bind pose.
  for (let index = 0; index < positions.count; index++) {
    if (positions.getY(index) <= 0.004) soles.push(index);
  }
  const vertex = new Vector3();
  return (body: Group) => {
    body.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const index of soles) lowest = Math.min(lowest, mesh.getVertexPosition(index, vertex).y);
    return MathUtils.clamp(-lowest, -0.009, 0.009);
  };
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

type AkitaProps = {
  ball: RefObject<BallState>;
  dog: RefObject<Group | null>;
  dogAnchors: RefObject<DogShadowAnchors | null>;
  handContact: RefObject<HandContact | null>;
};

export function AkitaDog(props: AkitaProps) {
  const quality = useGameUI((state) => state.quality);
  const model = useAkitaModel(quality);
  return model && <AkitaActor {...props} scene={model.scene} assetClips={model.animations} />;
}

function AkitaActor({ ball, dog, dogAnchors, handContact, scene, assetClips }: AkitaProps & { scene: Group; assetClips: AnimationClip[] }) {
  const animations = useMemo(() => {
    const idle = AnimationClip.findByName(assetClips, "Idle");
    const napDown = AnimationClip.findByName(assetClips, "NapDown");
    if (!idle || !napDown) throw new Error("Akita animation missing: Idle or NapDown");
    // Early in the authored lie-down the forepaws reach forward and both hind paws stay planted.
    const bow = AnimationUtils.subclip(napDown, "PlayBow", 0, 14, 24);
    const chin = touchClip(idle, "LiftChin", "head", new Vector3(1, 0, 0), (t) => 0.42 * Math.sin(Math.PI * t));
    const brush = touchClip(idle, "Brush", "tail_01", new Vector3(0, 1, 0), (t) => 0.58 * Math.sin(6 * Math.PI * t) * Math.sin(Math.PI * t));
    return [...assetClips, chin, brush, bow, ...reclineClips(assetClips)];
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
  useLayoutEffect(() => {
    const hips = skin.skeleton.getBoneByName("Spine_01");
    const chest = skin.skeleton.getBoneByName("Spine_05");
    const muzzle = skin.skeleton.getBoneByName("nose");
    if (!hips || !chest || !muzzle) throw new Error("Akita contact shadow anchors missing");
    dogAnchors.current = { hips, chest, muzzle };
    return () => { dogAnchors.current = null; };
  }, [dogAnchors, skin]);
  const rig = useRef<Group>(null);
  const idleHeight = useMemo(() => createIdleGrounding(skin), [skin]);
  const recline = useRef<Recline | null>(null);
  const poseReclined = useMemo(createReclinedPose, []);
  const roaming = useRef({ target: null as FloorPoint | null, restTime: 1.7, activeTime: 0, napAfter: 24 });
  const fetch = useRef<FetchTrip | null>(null);
  const invitation = useRef({ idle: 0, after: MathUtils.randFloat(30, 45), cooldown: 0 });
  const offer = useRef<PlayOffer | null>(null);
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
  const brushEquipped = useGameUI((state) => state.brushEquipped);
  const lastPetAt = useRef(-Infinity);
  const petStroke = useRef<PetStroke | null>(null);
  const brushing = useRef<{ pointer: number; startZ: number; completed: boolean } | null>(null);
  const rearTap = useRef<RearTap | null>(null);

  useEffect(() => {
    const resetIdle = () => { invitation.current.idle = 0; };
    window.addEventListener("pointerdown", resetIdle, true);
    window.addEventListener("pointermove", resetIdle, true);
    window.addEventListener("keydown", resetIdle, true);
    document.addEventListener("visibilitychange", resetIdle);
    return () => {
      window.removeEventListener("pointerdown", resetIdle, true);
      window.removeEventListener("pointermove", resetIdle, true);
      window.removeEventListener("keydown", resetIdle, true);
      document.removeEventListener("visibilitychange", resetIdle);
    };
  }, []);
  const rearReaction = useRef<RearReaction | null>(null);

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
      if (name === "PlayBow") action.setLoop(LoopPingPong, 2);
      else action.setLoop(LoopOnce, 1);
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
      if (action.getClip().name === "PlayBow") {
        play("Idle");
        return;
      }
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
      mixer.uncacheRoot(scene);
      currentAction.current = null;
    };
  }, [handContact, mixer, play, rest, scene]);

  const startInteraction = useCallback((interaction: Interaction, owner: number | null) => {
    const sceneBall = ball.current;
    const toy = sceneBall.mesh;
    const group = dog.current;
    const { pet } = useCloudPet.getState();
    offer.current = null;
    rearReaction.current = null;
    if (interaction.kind !== "pet" || interaction.part === "rear") reactions.fade();
    if (interaction.kind === "ball") {
      if (sceneBall.motion.phase !== "fetch" || fetch.current || !group || !toy) return;
      if (pet && pet.energy < 8) {
        sceneBall.motion = { phase: "rest" };
        useGameUI.getState().setNotice("团子有点累，休息一会儿再玩球。");
        return;
      }
      const plan = toy.position.y === ballGroundY && planFetch(group.position, toy.position);
      if (!plan) {
        sceneBall.motion = { phase: "rest" };
        useGameUI.getState().setNotice("球停在团子够不到的地方了。");
        return;
      }
      fetch.current = { plan, source: "throw", owner: sceneBall.motion.owner, phase: "chase", waypoint: 0 };
      approach.current = null;
      roaming.current.target = null;
      play("Idle");
      useGameUI.getState().setNotice("团子去追球了！");
      return;
    }

    const kind = interaction.kind;
    if (kind === "feed" || kind === "water" || kind === "call") {
      if (!group || approach.current?.kind === kind) return;
      const floorBall = ballFloorPoint(sceneBall);
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

    if (fetch.current) {
      if (sceneBall.motion.phase === "fetch") dropBall(sceneBall);
      fetch.current = null;
    }
    roaming.current.target = null;
    if (kind === "pet" && interaction.part === "rear") {
      if (currentAction.current?.getClip().name !== "Sit") play("Idle");
      roaming.current.restTime = 1.8;
      rearReaction.current = { target: interaction, phase: "contact", time: 0.21 };
    } else if (kind === "call") play("LookAround");
    else if (kind === "feed" || kind === "water") play("Idle");
    else {
      if (kind === "brush") play("Brush");
      else reactToPet(interaction);
      recordPetAction(kind, owner);
    }
  }, [ball, dog, play, reactions, reactToPet]);

  useEffect(() => {
    if (!interaction || interaction.sequence === playback.current.interactionSequence) return;
    playback.current.interactionSequence = interaction.sequence;
    if (interaction.kind !== "pet") petStroke.current = null;
    if (interaction.kind !== "ball" && !fetch.current && ball.current.motion.phase === "fetch") {
      ball.current.motion = { phase: "rest" };
    }
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
  }, [ball, interaction, play, reactToPet, startInteraction]);

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
    if (trip.phase === "pickup" || trip.phase === "drop") {
      const contacted = action.time >= biteTime;
      if (trip.phase === "pickup" && contacted && trip.source === "invitation" && ball.current.motion.phase === "rest") {
        ball.current.motion = { phase: "fetch", owner: null };
      }
      if (trip.phase === "pickup" ? contacted : !contacted) holdBall(toy);
      if (trip.phase === "drop" && contacted) {
        toy.position.set(delivery.ball.x, ballGroundY, delivery.ball.z);
        if (trip.source === "invitation") {
          nudgeBall(ball.current, { x: Math.sin(delivery.heading), z: Math.cos(delivery.heading) });
          fetch.current = null;
          offer.current = { phase: "wait", timeLeft: 8 };
          play("PlayBow");
          reactions.play({ part: "tailRoot" });
          useGameUI.getState().setNotice("团子把球推到你面前，等你陪它玩。");
          return;
        }
      }
      if (action.time < action.getClip().duration) return;

      if (trip.phase === "pickup") {
        trip.phase = "return";
        trip.waypoint = 0;
        play("Carry");
        useGameUI.getState().setNotice("团子叼起球往回走。");
      } else {
        fetch.current = null;
        ball.current.motion = { phase: "rest" };
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
      const running = trip.source === "throw" && !carrying && hasRoomToRun(group.position, pickup.ball);
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
    const cloud = useCloudPet.getState();
    const pose = currentAction.current?.getClip().name;
    const contact = handContact.current;
    const ballPhase = ball.current.motion.phase;
    const ui = useGameUI.getState();
    const timing = invitation.current;
    if (!document.hidden) {
      timing.cooldown = Math.max(0, timing.cooldown - step);
      if (ui.panel || ui.foodOpen || contact?.pressed || ballPhase === "held") timing.idle = 0;
      else timing.idle += step;
    }
    const canWag = (pose === "Idle" || pose === "Walk") &&
      !approach.current && !recline.current && !rearReaction.current && ballPhase !== "flight" && ballPhase !== "fetch" &&
      !(contact?.pressed && isTailPart(contact.gesture));
    reactions.updateTail(step, cloud.pet, canWag);
    mixer.update(step);

    const group = dog.current;
    const action = currentAction.current;
    if (!group || !action) return;

    const toy = ball.current.mesh;
    const clip = action.getClip().name;
    const body = rig.current;
    if (body && !recline.current) {
      const height = clip === "Idle" ? idleHeight(body) : 0;
      body.position.y = MathUtils.damp(body.position.y, height, 34, step);
    }
    const cue = rearReaction.current;
    if (cue?.phase === "contact") {
      cue.time -= step;
      if (cue.time <= 0) {
        reactions.play(cue.target);
        cue.phase = "recoil";
        cue.time = 0.48;
      }
    } else if (cue?.phase === "recoil") {
      cue.time -= step;
      if (cue.time <= 0 && !fetch.current) {
        reactions.fade();
        cue.phase = "turn";
        play("Walk");
      }
    } else if (cue?.phase === "turn") {
      if (face(group, headingTo(group.position, camera.position), turnSpeed * step)) {
        rearReaction.current = null;
        rest();
        useGameUI.getState().setNotice("团子转过身，面向你站好了。");
      }
      return;
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
      // Until the dog's mouth actually takes it, the player can still pick up the ball first.
      if (trip.source === "invitation" && ballPhase !== "rest" && ballPhase !== "fetch") {
        fetch.current = null;
        rest();
        return;
      }
      advanceFetch(trip, group, toy, action, step);
      return;
    }

    const greeting = offer.current;
    if (greeting) {
      if (ball.current.motion.phase === "flight" && ball.current.motion.play) {
        offer.current = null;
        rest();
      } else if (greeting.phase === "stepBack") {
        const walk = play("Walk");
        walk.setEffectiveTimeScale(-0.72);
        if (moveToward(group.position, greeting.target, walkSpeed * 0.72 * step * walk.getEffectiveWeight())) {
          offer.current = null;
          rest();
        }
      } else if (ballPhase === "held") {
        const target = planShortStep(group.position, group.rotation.y, -0.38);
        offer.current = target ? { phase: "stepBack", target } : null;
        if (!target) rest();
      } else {
        greeting.timeLeft -= step;
        if (greeting.timeLeft <= 0) {
          offer.current = null;
          rest();
          roaming.current.restTime = 0;
        }
      }
      return;
    }

    const visit = approach.current;
    if (visit) {
      const { kind } = visit;
      const target = visit.route[visit.waypoint];
      const heading = target ? headingTo(group.position, target) : visit.heading;
      if (kind === "call" && action.getClip().name === "LookAround" && action.time < 0.55) {
        face(group, headingTo(group.position, camera.position), turnSpeed * step);
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
    const petting = touch?.pressed === true && stroke?.pointer === touch.pointer;
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

    const grooming = brushEquipped && touch?.pressed && touch.gesture === "brush";
    if (grooming && clip === "Walk") {
      rest();
      return;
    }
    const activity = roaming.current;
    const ballMotion = ball.current.motion;
    if (ballMotion.phase === "flight" && ballMotion.play?.sequence === (interaction?.sequence ?? 0)) {
      if (clip === "Walk") rest();
      return;
    }
    const ballPosition = ballFloorPoint(ball.current);
    const free = clip === "Idle" || clip === "Walk" || clip === "Sit";
    if (free) activity.activeTime += step;
    const tired = cloud.pet?.sleeping || (cloud.pet?.energy ?? 100) < 25;
    const canInvite = free && !document.hidden && !tired && !ui.panel && !ui.foodOpen && !contact?.pressed &&
      timing.cooldown <= 0 && ballMotion.phase === "rest" && toy?.position.y === ballGroundY;
    if (canInvite && timing.idle >= timing.after) {
      const plan = planPlayInvitation(group.position, ballPosition);
      timing.idle = 0;
      timing.after = MathUtils.randFloat(30, 45);
      if (plan) {
        timing.cooldown = MathUtils.randFloat(120, 155);
        activity.target = null;
        fetch.current = { source: "invitation", plan, owner: null, phase: "chase", waypoint: 0 };
        play("Idle");
        ui.setNotice("团子想找你玩，去叼球了。");
        return;
      }
    }
    if (clip === "Idle") {
      if (petting || grooming) return;
      activity.restTime -= step;
      if (activity.restTime > 0) return;
      const { accountId: owner, pet } = cloud;
      const napAfter = pet?.sleeping ? 0 : pet && pet.energy < 25 ? 8 : activity.napAfter;
      if (activity.activeTime >= napAfter && !(canInvite && timing.idle >= 18)) {
        activity.activeTime = 0;
        activity.napAfter = MathUtils.randFloat(24, 38);
        const plan = planNap(group.position, ballPosition);
        if (plan) {
          approach.current = { ...plan, kind: "nap", waypoint: 0, owner };
          useGameUI.getState().setNotice("团子准备去狗窝旁休息。");
          return;
        }
      }
      activity.target = chooseWalkTarget(group.position, ballPosition);
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

  const contactFromPointer = (event: ThreeEvent<PointerEvent>, gesture: HandGesture, pressed: boolean): HandContact | null => {
    const { object, face, barycoord } = event;
    if (!dog.current || !(object instanceof SkinnedMesh) || !face || !barycoord) return null;
    const previous = handContact.current;
    const samePointer = previous?.pointer === event.pointerId;
    const now = performance.now();
    const startedAt = event.type === "pointerdown" ? now : samePointer ? previous.startedAt : null;
    return {
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
      visibleUntil: Infinity,
    };
  };

  const placeHand = (event: ThreeEvent<PointerEvent>, gesture: HandGesture, pressed: boolean) => {
    const contact = contactFromPointer(event, gesture, pressed);
    if (contact) handContact.current = contact;
  };

  const startPetStroke = (pointer: number, target: PetTarget, now: number) => {
    if (now - lastPetAt.current < petReactionCooldown) return;
    lastPetAt.current = now;
    petStroke.current = { pointer, target, next: null, rub: { seconds: 0, distance: 0, previousPoint: null } };
    trigger("pet", target);
  };

  const pointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!event.isPrimary || event.button !== 0) return;
    petStroke.current = null;
    brushing.current = null;
    rearTap.current = null;
    const canTapRear = !nap.current && !recline.current;
    const target = hitPetTarget(event, canTapRear ? "tap" : "stroke");
    if (!target) return;
    event.stopPropagation();
    const now = performance.now();
    if (brushEquipped && target.part === "back" && dog.current) {
      placeHand(event, "brush", true);
      const startZ = dog.current.worldToLocal(event.point.clone()).z;
      brushing.current = { pointer: event.pointerId, startZ, completed: false };
      return;
    }
    if (target.part === "rear") {
      const contact = contactFromPointer(event, target.part, true);
      if (!contact) return;
      rearTap.current = { contact, target, x: event.clientX, y: event.clientY, startedAt: now };
      const normalTouch = hitPetTarget(event);
      if (normalTouch) handContact.current = { ...contact, gesture: normalTouch.part };
      (event.target as Element).setPointerCapture(event.pointerId);
    } else {
      placeHand(event, target.part, true);
      startPetStroke(event.pointerId, target, now);
    }
    pulseOnTouch(event);
  };

  const pointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!event.isPrimary) return;
    const picked = hitPetTarget(event);
    const part = picked?.part;
    const pressed = (event.buttons & 1) !== 0;
    const brushStroke = brushing.current?.pointer === event.pointerId ? brushing.current : null;
    const onBackWithBrush = brushEquipped && part === "back" && (!pressed || brushStroke !== null);
    const target = handContact.current;
    const now = performance.now();
    if (target?.gesture === "rear" && now < target.visibleUntil) return;
    const tapping = rearTap.current;
    if (tapping?.contact.pointer === event.pointerId && pressed) {
      const limit = tapping.contact.touch ? 12 : rearDragLimit;
      if (Math.hypot(event.clientX - tapping.x, event.clientY - tapping.y) <= limit) return;
      rearTap.current = null;
      (event.target as Element).releasePointerCapture(event.pointerId);
      if (picked) startPetStroke(event.pointerId, picked, now);
    }
    if (part && (!brushStroke || onBackWithBrush) && (event.pointerType === "mouse" || pressed)) {
      placeHand(event, onBackWithBrush ? "brush" : part, pressed);
    } else if (target?.pointer === event.pointerId) {
      handContact.current = null;
    }
    const petting = petStroke.current;
    if (petting?.pointer === event.pointerId) {
      if (!pressed || !picked || samePetTarget(picked, petting.target)) {
        petting.next = null;
      } else if (!samePetTarget(picked, petting.next?.target)) {
        petting.next = { target: picked, screenPoint: event.pointer.clone(), since: now };
      }
    }

    if (!brushStroke || brushStroke.completed || !pressed || !onBackWithBrush || !dog.current) return;
    const z = dog.current.worldToLocal(event.point.clone()).z;
    if ((brushStroke.startZ - z) * dogScale < brushStrokeLength) return;
    brushStroke.completed = true;
    trigger("brush", { part: "back" });
  };

  const finishPointer = (event: ThreeEvent<PointerEvent>) => {
    const tapping = rearTap.current;
    if (tapping?.contact.pointer === event.pointerId && event.type !== "pointerout") {
      rearTap.current = null;
      const pointerTarget = event.target as Element;
      if (pointerTarget.hasPointerCapture(event.pointerId)) pointerTarget.releasePointerCapture(event.pointerId);
      if (event.type === "pointerup") {
        const now = performance.now();
        const limit = tapping.contact.touch ? 12 : rearDragLimit;
        if (now - tapping.startedAt <= rearTapLimit && Math.hypot(event.clientX - tapping.x, event.clientY - tapping.y) <= limit) {
          handContact.current = { ...tapping.contact, startedAt: now, pressed: false, visibleUntil: now + 540 };
          trigger("pet", tapping.target);
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
      if (event.type === "pointerup" && !recline.current && !nap.current && !approach.current && !fetch.current &&
          group && (base === "Idle" || base === "Sit") && isRubArea(target?.gesture) &&
          petting.rub.seconds >= 1.15 && petting.rub.distance >= (target?.touch ? 14 : 22)) {
        const facingCamera = headingTo(group.position, event.camera.position);
        const headings = [facingCamera + Math.PI / 2, facingCamera + 1.22, facingCamera + 1.91];
        const heading = headings.find((angle) => canReclineAt(group.position, angle, ballFloorPoint(ball.current)));
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
      position={[dogHome.x, floorSurface, dogHome.z]}
      rotation={[0, -0.65, 0]}
      scale={dogScale}
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
