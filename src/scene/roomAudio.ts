import akitaBarkUrl from "../assets/akita-bark.mp3?inline";
import akitaPantUrl from "../assets/akita-pant.mp3?inline";
import bounceUrl from "../assets/ball-bounce.wav?inline";
import pawWoodUrl from "../assets/paw-wood.wav?inline";
import pawCarpetUrl from "../assets/paw-carpet.wav?inline";
import { useGameUI } from "../store/useGameUI";
import type { FloorMaterial } from "./roomNavigation";

const clips = {
  bounce: bounceUrl,
  wood: pawWoodUrl,
  carpet: pawCarpetUrl,
  akitaPant: akitaPantUrl,
  akitaBark: akitaBarkUrl,
};
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
    useGameUI.subscribe((state, previous) => {
      if (state.soundEnabled !== previous.soundEnabled) {
        master.gain.setTargetAtTime(Number(state.soundEnabled), audio.currentTime, 0.01);
      }
    });
    for (const clip of Object.keys(clips) as Clip[]) {
      void fetch(clips[clip]).then((response) => response.arrayBuffer())
        .then((data) => audio.decodeAudioData(data)).then((buffer) => buffers.set(clip, buffer))
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
  const volume = (surface === "wood" ? 0.16 : 0.105) * intensity;
  playSound(surface, volume, 0.94 + Math.random() * 0.12);
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
