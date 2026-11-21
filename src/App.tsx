import { useEffect } from "react";
import { refreshCloud, useCloudPet } from "./cloud/useCloudPet";
import { PetWorld } from "./scene/PetWorld";
import { unlockRoomAudio } from "./scene/roomAudio";
import { GameHUD } from "./ui/GameHUD";

export default function App() {
  useEffect(() => {
    refreshCloud();
    window.addEventListener("focus", refreshCloud);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && useCloudPet.getState().email) refreshCloud();
    }, 45_000);
    return () => {
      window.removeEventListener("focus", refreshCloud);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="game-shell" aria-label="倩岚汪宠物房间" onPointerUpCapture={unlockRoomAudio} onKeyDownCapture={unlockRoomAudio}>
      <PetWorld />
      <GameHUD />
    </main>
  );
}
