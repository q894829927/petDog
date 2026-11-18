import { PetWorld } from "./scene/PetWorld";
import { GameHUD } from "./ui/GameHUD";

export default function App() {
  return (
    <main className="game-shell" aria-label="倩岚汪宠物房间">
      <PetWorld />
      <GameHUD />
    </main>
  );
}
