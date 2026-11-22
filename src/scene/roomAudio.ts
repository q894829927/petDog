import bounceUrl from "../assets/ball-bounce.wav?inline";
import { useGameUI } from "../store/useGameUI";
import type { FloorMaterial } from "./roomNavigation";

let buffer: AudioBuffer | undefined;
let context: AudioContext | undefined;
let output: GainNode | undefined;

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
    void fetch(bounceUrl).then((response) => response.arrayBuffer())
      .then((data) => audio.decodeAudioData(data)).then((decoded) => { buffer = decoded; })
      .catch((error: unknown) => console.warn("Ball sound could not be decoded", error));
  }
  if (context.state !== "running") void context.resume().catch(() => {});
}

export function playBallBounce(speed: number, surface: FloorMaterial) {
  if (speed < 0.6 || !buffer || context?.state !== "running" || !output ||
      document.hidden || !useGameUI.getState().soundEnabled) return;

  const strength = Math.min(1, speed / 10);
  const soft = surface === "carpet";
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 0.94 + strength * 0.12;
  const gain = context.createGain();
  gain.gain.value = (0.03 + 0.32 * strength ** 1.25) * (soft ? 0.76 : 1);
  gain.connect(output);
  const filter = soft ? context.createBiquadFilter() : null;
  if (filter) {
    filter.type = "lowpass";
    filter.frequency.value = 1100;
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
}
