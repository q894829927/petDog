import akitaBarkUrl from "../assets/akita-bark.mp3?inline";
import akitaPantUrl from "../assets/akita-pant.mp3?inline";
import bounceUrl from "../assets/ball-bounce.wav?inline";
import ambienceUrl from "../assets/living-room-ambience.mp3?url";
import pawWoodAUrl from "../assets/paw-wood-a.mp3?inline";
import pawWoodBUrl from "../assets/paw-wood-b.mp3?inline";
import pawCarpetAUrl from "../assets/paw-carpet-a.mp3?inline";
import pawCarpetBUrl from "../assets/paw-carpet-b.mp3?inline";
import { useGameUI } from "../store/useGameUI";
import type { FloorMaterial } from "./roomNavigation";

const clips = {
  bounce: bounceUrl,
  woodA: pawWoodAUrl,
  woodB: pawWoodBUrl,
  carpetA: pawCarpetAUrl,
  carpetB: pawCarpetBUrl,
  akitaPant: akitaPantUrl,
  akitaBark: akitaBarkUrl,
  ambience: ambienceUrl,
};
const pawTakes = { wood: ["woodA", "woodB"], carpet: ["carpetA", "carpetB"] } as const;
type Clip = keyof typeof clips;
const buffers = new Map<Clip, AudioBuffer>();
let context: AudioContext | undefined;
let output: GainNode | undefined;
let pantEndsAt = 0;
let nextBarkAt = 0;

export function unlockRoomAudio() {
  if (typeof AudioContext === "undefined") return;
  if (!context) {
    const audio = new AudioContext();
    context = audio;
    const master = audio.createGain();
    master.gain.value = Number(useGameUI.getState().soundEnabled);
    master.connect(audio.destination);
    output = master;

    const ambienceGain = audio.createGain();
    ambienceGain.gain.value = 0;
    ambienceGain.connect(master);
    let ambience: AudioBufferSourceNode | undefined;
    const syncAmbience = () => {
      if (audio.state !== "running" || document.hidden || !useGameUI.getState().soundEnabled) {
        ambience?.stop();
        ambience?.disconnect();
        ambience = undefined;
        return;
      }
      const buffer = buffers.get("ambience");
      if (!buffer || ambience) return;
      ambience = audio.createBufferSource();
      ambience.buffer = buffer;
      ambience.loop = true;
      ambience.connect(ambienceGain);
      const now = audio.currentTime;
      ambienceGain.gain.setValueAtTime(0, now);
      ambienceGain.gain.setTargetAtTime(0.02, now, 0.08);
      ambience.start();
    };
    audio.addEventListener("statechange", syncAmbience);
    document.addEventListener("visibilitychange", syncAmbience);
    useGameUI.subscribe((state, previous) => {
      if (state.soundEnabled !== previous.soundEnabled) {
        master.gain.setTargetAtTime(Number(state.soundEnabled), audio.currentTime, 0.01);
        syncAmbience();
      }
    });
    for (const clip of Object.keys(clips) as Clip[]) {
      void fetch(clips[clip]).then((response) => response.arrayBuffer())
        .then((data) => audio.decodeAudioData(data)).then((buffer) => {
          buffers.set(clip, buffer);
          if (clip === "ambience") syncAmbience();
        })
        .catch((error: unknown) => console.warn("Room sound could not be decoded", error));
    }
  }
  if (context.state !== "running") void context.resume().catch(() => {});
}

function playSound(clip: Clip, volume: number, rate: number, lowpass?: number) {
  const buffer = buffers.get(clip);
  if (!buffer || context?.state !== "running" || !output || document.hidden || !useGameUI.getState().soundEnabled) return;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(output);
  const filter = lowpass ? context.createBiquadFilter() : null;
  if (filter && lowpass) {
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    source.connect(filter).connect(gain);
  } else {
    source.connect(gain);
  }
  source.onended = () => {
    source.disconnect();
    filter?.disconnect();
    gain.disconnect();
  };
  source.start();
  return context.currentTime + buffer.duration / rate;
}

export function playBallBounce(speed: number, surface: FloorMaterial) {
  if (speed < 0.6) return;
  const strength = Math.min(1, speed / 10);
  const volume = 0.03 + 0.32 * strength ** 1.25;
  const soft = surface === "carpet";
  playSound("bounce", soft ? volume * 0.76 : volume, 0.94 + strength * 0.12, soft ? 1100 : undefined);
}

export function playPawStep(surface: FloorMaterial, intensity: number) {
  const [first, second] = pawTakes[surface];
  const take = Math.random() < 0.5 ? first : second;
  const volume = (surface === "wood" ? 0.057 : 0.04) * intensity * (0.9 + Math.random() * 0.2);
  playSound(take, volume, 0.94 + Math.random() * 0.12);
}

export function playAkitaPant() {
  const endsAt = playSound("akitaPant", 0.24, 0.96 + Math.random() * 0.08);
  if (endsAt !== undefined) pantEndsAt = endsAt;
}

export function maybePlayAkitaBark() {
  if (!context || context.currentTime < Math.max(pantEndsAt, nextBarkAt) || Math.random() >= 0.25) return;
  const endsAt = playSound("akitaBark", 0.14, 0.93 + Math.random() * 0.09);
  if (endsAt !== undefined) nextBarkAt = endsAt + 45 + Math.random() * 20;
}
