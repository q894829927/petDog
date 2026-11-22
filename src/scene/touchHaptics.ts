export function pulseOnTouch({ pointerId, pointerType }: Pick<PointerEvent, "pointerId" | "pointerType">) {
  if (pointerType !== "touch" || !navigator.vibrate) return;
  const pulse = () => navigator.vibrate(14);
  if (navigator.userActivation?.hasBeenActive !== false) {
    pulse();
    return;
  }

  // On the first touch, browser activation arrives at release.
  const pending = new AbortController();
  const finish = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    pending.abort();
    if (event.type === "pointerup") pulse();
  };
  const options = { capture: true, signal: pending.signal };
  window.addEventListener("pointerup", finish, options);
  window.addEventListener("pointercancel", finish, options);
}
