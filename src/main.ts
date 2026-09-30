import { Game } from "./game";
import { photosReady, preloadPhotos } from "./world/photo";
import { loadSkins } from "./characters/skins";
import "./hud/style.css";

declare const __APP_VERSION__: string;

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const title = byId("title");
const status = byId("status");
byId("version").textContent = `v${__APP_VERSION__}`;

const TIPS = [
  "Walk into the wind. Your scent blows the other way.",
  "Crouch in a bush and keep still, and a deer can walk right past.",
  "A snapped twig carries thirty metres. Creep over the dry patches.",
  "Arrows drop over distance and drift with the wind. Aim a touch high and upwind.",
  "A wounded animal bleeds. Follow the trail.",
  "The glass tells you how far away something is.",
  "Stags come to the call. Too soon after spooking them, they won't.",
];
byId("tip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)]!;

// Let the loading text paint before the wood is grown.
setTimeout(async () => {
  preloadPhotos();
  await loadSkins();
  try {
    const game = new Game(byId("game"), { title, pause: byId("pause"), pauseScore: byId("pause-score") });
    game.start();
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
    status.textContent = "Loading textures…";
    void photosReady.then(() => {
      status.textContent = "";
      byId("go").hidden = false;
    });
  } catch (err) {
    console.error(err);
    status.textContent = "The wood failed to grow. This browser may not support WebGL.";
  }
}, 50);
