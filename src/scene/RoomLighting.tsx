import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, MathUtils, type DirectionalLight, type HemisphereLight, type Light, type MeshBasicMaterial } from "three";

const light = (color: string, intensity: number) => ({ color: new Color(color), intensity });
const night = {
  sky: light("#c9d7f3", 1.34), ground: new Color("#a3928a"),
  sun: light("#b9cfff", 0.34), fill: light("#ffedd6", 1.15), shadow: 0.34,
  window: new Color("#758bb1"), background: new Color("#9699a5"),
};
const morning = {
  sky: light("#ffe9d1", 1.86), ground: new Color("#c1ab98"),
  sun: light("#ffe0b6", 1.88), fill: light("#fff6e9", 0.85), shadow: 0.78,
  window: new Color("#f6dbc0"), background: new Color("#e6ceb4"),
};
const afternoon = {
  sky: light("#fff5e4", 2.05), ground: new Color("#c8b09e"),
  sun: light("#fff0d2", 2.32), fill: light("#fff7ed", 0.85), shadow: 0.92,
  window: new Color("#ffffff"), background: new Color("#e8dcc9"),
};
const sunset = {
  sky: light("#ffe0bd", 1.64), ground: new Color("#c19e88"),
  sun: light("#ffb57d", 1.72), fill: light("#ffe8d1", 0.83), shadow: 0.66,
  window: new Color("#f4bf8d"), background: new Color("#d9ad8e"),
};

const timeline = [
  [0, night], [5, night], [7, morning], [11.5, afternoon],
  [15.5, afternoon], [18.5, sunset], [21, night], [24, night],
] as const;

export function RoomLighting({ shadows, windowMaterial }: {
  shadows: boolean;
  windowMaterial: RefObject<MeshBasicMaterial | null>;
}) {
  const background = useRef<Color>(null);
  const sky = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const mixedColor = useRef(new Color());
  const initialized = useRef(false);

  useFrame((_, delta) => {
    if (!sky.current || !sun.current || !fill.current || !background.current || !windowMaterial.current) return;
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const upper = timeline.findIndex(([time]) => hour < time);
    const [start, from] = timeline[upper - 1];
    const [end, to] = timeline[upper];
    const blend = MathUtils.smoothstep(hour, start, end);
    const ease = initialized.current ? 1 - Math.exp(-3 * Math.min(delta, 0.1)) : 1;
    initialized.current = true;

    const tint = (color: Color, a: Color, b: Color) => color.lerp(mixedColor.current.lerpColors(a, b, blend), ease);
    const strength = (value: number, a: number, b: number) => MathUtils.lerp(value, MathUtils.lerp(a, b, blend), ease);
    const illuminate = (lamp: Light, a: typeof from.sky, b: typeof to.sky) => {
      tint(lamp.color, a.color, b.color);
      lamp.intensity = strength(lamp.intensity, a.intensity, b.intensity);
    };
    illuminate(sky.current, from.sky, to.sky);
    illuminate(sun.current, from.sun, to.sun);
    illuminate(fill.current, from.fill, to.fill);
    tint(sky.current.groundColor, from.ground, to.ground);
    tint(background.current, from.background, to.background);
    tint(windowMaterial.current.color, from.window, to.window);
    sun.current.shadow.intensity = strength(sun.current.shadow.intensity, from.shadow, to.shadow);
  });

  return (
    <>
      <color attach="background" args={["#e8dcc9"]} ref={background} />
      <hemisphereLight name="Room hemisphere light" ref={sky} />
      <directionalLight name="Window light" ref={sun} position={[3.8, 7.5, -4.5]}
        castShadow={shadows} shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-left={-8.1} shadow-camera-right={8.1} shadow-camera-top={8.1} shadow-camera-bottom={-8.1}
        shadow-camera-far={19} shadow-bias={-0.00015} shadow-normalBias={0.006} />
      <directionalLight name="Room fill light" ref={fill} position={[-2.9, 4.2, 6]} />
    </>
  );
}
