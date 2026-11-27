type Sample = { x: number; y: number; time: number };
type Swing = { x: number; z: number };

const swingWindow = 200;
const holdToFeint = 250;

export class BallThrowGesture {
  releaseFromX: number;
  releaseFromY: number;
  feint: Swing | null = null;
  private samples: Sample[];
  private minSwing: number;
  private pending: Swing | null = null;
  private resting = true;

  constructor(x: number, y: number, time: number, shortEdge: number) {
    this.releaseFromX = x;
    this.releaseFromY = y;
    this.samples = [{ x, y, time }];
    this.minSwing = Math.max(32, Math.min(64, shortEdge * 0.08));
  }

  move(x: number, y: number, time: number) {
    const last = this.samples[this.samples.length - 1];
    if (Math.hypot(x - last.x, y - last.y) < 5) return;
    // A pause between two pointer events can outlast a frame on a busy device.
    if (time - last.time >= holdToFeint) this.hold(time);
    if (this.resting) {
      // The first move starts the swing clock, even after a long stationary grab.
      last.time = time;
      this.resting = false;
    }
    this.samples = this.samples.filter(point => time - point.time <= swingWindow);
    const first = this.samples[0];
    const dx = first ? x - first.x : 0;
    const dy = first ? y - first.y : 0;
    const distance = Math.hypot(dx, dy);
    this.pending = distance >= this.minSwing ? { x: dx / distance, z: dy / distance } : null;
    this.samples.push({ x, y, time });
  }

  hold(time: number) {
    if (this.resting) return;
    const last = this.samples[this.samples.length - 1];
    if (this.pending) {
      if (time - last.time < holdToFeint) return;
      this.feint = this.pending;
      this.pending = null;
      this.releaseFromX = last.x;
      this.releaseFromY = last.y;
    } else if (time - last.time < swingWindow) {
      return;
    }
    this.samples = [last];
    this.resting = true;
  }

  release(x: number, y: number, time: number) {
    this.hold(time);
    return { dx: x - this.releaseFromX, dy: y - this.releaseFromY };
  }
}
