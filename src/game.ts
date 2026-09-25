import * as THREE from "three";
import { Wildlife } from "./animals/wildlife";
import type { Animal } from "./animals/animal";
import { clamp, forwardOfYaw, yawToBearing } from "./core/math";
import { makeNoise2 } from "./core/simplex";
import { castAim } from "./hunt/aim";
import { Arrows, type ArrowHit } from "./hunt/arrows";
import { Hud, SLOTS, type Slot } from "./hud/hud";
import { ThirdPersonCamera, type View } from "./player/camera";
import { Input } from "./player/input";
import { Player } from "./player/player";
import { Woodsman } from "./player/woodsman";
import { Sounds } from "./sound/audio";
import { loudnessAt, NoiseBus, type NoiseEvent, type NoiseKind } from "./sound/noise";
import type { Context } from "./world/context";
import { BloodTrail, Campfire, Motes, softDot } from "./world/effects";
import { Forest } from "./world/forest";
import { scatter } from "./world/scatter";
import { Sky } from "./world/sky";
import { swayUniforms } from "./world/sway";
import { buildWater, Terrain } from "./world/terrain";
import { Wind } from "./world/wind";

const QUIVER = 12;
const DRAW_TIME = 0.85;
const CALL_COOLDOWN = 8;

type Mode = "title" | "playing" | "paused";

interface LogEntry { name: string; points: number; note: string }

const ZONE_NOTE = { head: "head shot", vital: "heart & lungs", body: "body shot" } as const;

/**
 * The hunt: builds the wood, then runs it a frame at a time. Owns the rules
 * of the bow, the binoculars and the call, and turns what happens into
 * sounds, pings and entries in the hunting log.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly input: Input;
  private readonly sounds = new Sounds();
  private readonly hud: Hud;
  private readonly ctx: Context;
  private readonly player: Player;
  private readonly woodsman = new Woodsman();
  private readonly cam: ThirdPersonCamera;
  private readonly forest: Forest;
  private readonly sky: Sky;
  private readonly campfire: Campfire;
  private readonly motes: Motes;
  private readonly wildlife: Wildlife;
  private readonly arrows: Arrows;
  private readonly shake = makeNoise2(77);
  private readonly timer = new THREE.Timer();

  private mode: Mode = "title";
  private slot: Slot = "bow";
  private quiver = QUIVER;
  private drawing = false;
  private draw = 0;
  private fullFor = 0;
  private nockTimer = 0;
  private callTimer = 0;
  private emptyWarned = false;
  private score = 0;
  private readonly log: LogEntry[] = [];
  private time = 0;
  private binoInfo: { range: number | null; subject: string | null } | null = null;
  private binoTimer = 0;

  constructor(private readonly container: HTMLElement, private readonly overlays: { title: HTMLElement; pause: HTMLElement; pauseScore: HTMLElement }) {
    const seed = Number(new URLSearchParams(location.search).get("seed")) || 1861;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    container.appendChild(this.renderer.domElement);

    const terrain = new Terrain(seed);
    const layout = scatter(seed, terrain);
    this.scene.add(terrain.mesh, buildWater());
    this.sky = new Sky(this.scene, this.renderer);
    this.forest = new Forest(layout, terrain);
    this.scene.add(this.forest.group);

    const dot = softDot();
    const blood = new BloodTrail();
    this.scene.add(blood.mesh);
    this.campfire = new Campfire(0, 0, terrain, dot);
    this.scene.add(this.campfire.group);
    this.motes = new Motes(dot);
    this.scene.add(this.motes.points);

    const noise = new NoiseBus();
    const wind = new Wind(seed);
    // The hunter starts beside the fire, placeholder until the Player exists.
    const hunter = { position: new THREE.Vector3(), crouched: false, speed: 0, inCover: false };
    this.ctx = { terrain, layout, wind, noise, blood, hunter, time: 0 };
    this.player = new Player(2.5, 3.5, this.ctx);
    this.ctx.hunter = this.player;
    this.scene.add(this.woodsman.root);

    this.wildlife = new Wildlife(this.ctx);
    this.scene.add(this.wildlife.group);
    this.arrows = new Arrows(this.ctx, this.wildlife);
    this.scene.add(this.arrows.group);
    this.arrows.onHit = (hit) => this.onArrowHit(hit);

    noise.on((e) => this.onNoise(e));

    this.cam = new ThirdPersonCamera(container.clientWidth / container.clientHeight);
    this.cam.yaw = 0.35;
    this.player.yaw = this.cam.yaw;
    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(document.body);
    this.hud.setLog(0, []);

    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked && this.mode === "playing") this.pause();
    });
    overlays.title.addEventListener("click", () => this.begin());
    overlays.pause.addEventListener("click", () => this.begin());
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private begin(): void {
    this.sounds.start();
    this.input.lock();
    const first = this.mode === "title";
    this.mode = "playing";
    this.overlays.title.classList.add("hidden");
    this.overlays.pause.classList.add("hidden");
    this.hud.show(true);
    if (first) {
      this.hud.toast("The hunt is on", "Keep the wind in your face, and listen.", "");
    }
  }

  private pause(): void {
    this.mode = "paused";
    this.releaseDraw(false);
    this.overlays.pauseScore.textContent = this.log.length
      ? `${this.score} points · ${this.log.length} taken`
      : "Nothing taken yet";
    this.overlays.pause.classList.remove("hidden");
    this.hud.show(false);
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.campfire.setScale(h * Math.min(window.devicePixelRatio, 1.5), 68);
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.time += dt;
    this.ctx.time = this.time;

    if (this.mode === "playing") this.play(dt);
    else this.idle(dt);

    this.ctx.wind.update(dt);
    const w = this.ctx.wind.vector;
    swayUniforms.uTime.value = this.time;
    swayUniforms.uWind.value.set(w.x, w.z);
    this.wildlife.update(dt);
    this.campfire.update(dt, w);
    this.motes.update(dt, w, this.cam.camera.position, this.time);
    this.forest.update(this.cam.camera);
    this.sky.follow(this.player.position);
    this.sky.update(this.time);

    const c = this.cam.camera;
    this.sounds.setListener(c.position.x, c.position.y, c.position.z, this.cam.look.x, this.cam.look.y, this.cam.look.z);
    this.sounds.update(dt, this.ctx.wind.speed, c.position);

    this.renderer.render(this.scene, c);
    this.input.endFrame();
  }

  /** Behind the title and pause screens the wood carries on; the hunter just stands. */
  private idle(dt: number): void {
    if (this.mode === "title") this.cam.yaw += dt * 0.04;
    this.woodsman.root.position.copy(this.player.position);
    this.woodsman.root.rotation.y = this.player.yaw;
    this.woodsman.update(dt, { speed: 0, crouch: this.player.crouched ? 1 : 0, raise: 0, draw: 0, pitch: 0, nocked: this.quiver > 0 });
    this.cam.update(dt, this.player.position, this.woodsman.crouchAmount, "free", this.ctx);
    this.arrows.update(dt, () => undefined);
  }

  private play(dt: number): void {
    const input = this.input;

    // What is in hand.
    let newSlot: Slot | null = null;
    SLOTS.forEach((s, i) => { if (input.tapped(`Digit${i + 1}`)) newSlot = s; });
    if (input.wheel !== 0 && !this.drawing) {
      const i = SLOTS.indexOf(this.slot);
      newSlot = SLOTS[(i + (input.wheel > 0 ? 1 : -1) + SLOTS.length) % SLOTS.length]!;
    }
    if (newSlot && newSlot !== this.slot) {
      this.releaseDraw(false);
      this.slot = newSlot;
    }
    if (input.tapped("KeyC")) this.player.crouched = !this.player.crouched;
    if (input.tapped("KeyM")) this.sounds.setMuted(!this.sounds.muted);

    const view: View = input.right ? (this.slot === "binoculars" ? "binoculars" : this.slot === "bow" ? "aim" : "free") : "free";
    this.cam.turn(input.dx, input.dy, input.sensitivity, view);

    this.updateBow(dt, view);
    this.updateCall(dt);

    const forward = (input.held("KeyW") || input.held("ArrowUp") ? 1 : 0) - (input.held("KeyS") || input.held("ArrowDown") ? 1 : 0);
    const strafe = (input.held("KeyD") || input.held("ArrowRight") ? 1 : 0) - (input.held("KeyA") || input.held("ArrowLeft") ? 1 : 0);
    const raised = this.slot === "bow" && (view === "aim" || this.drawing);
    this.player.update(
      dt,
      { forward, strafe, run: input.held("ShiftLeft") || input.held("ShiftRight"), steady: raised || view === "binoculars" },
      this.cam.yaw,
      // Always square to the camera, so the view stays behind the hunter.
      true,
      this.ctx,
      (kind, radius) => this.emitFromPlayer(kind, radius),
    );

    this.woodsman.root.position.copy(this.player.position);
    this.woodsman.root.rotation.y = this.player.yaw;
    this.woodsman.root.visible = view !== "binoculars";
    this.woodsman.update(dt, {
      speed: this.player.forwardSpeed,
      crouch: this.player.crouched ? 1 : 0,
      raise: raised ? 1 : 0,
      draw: this.drawing ? this.draw : 0,
      pitch: this.cam.pitch,
      nocked: this.quiver > 0 && this.nockTimer <= 0,
    });
    this.cam.update(dt, this.player.position, this.woodsman.crouchAmount, view, this.ctx);

    this.arrows.update(dt, (kind, p) => {
      const radius = kind === "thud" ? 30 : kind === "flesh" ? 20 : 14;
      const loud = loudnessAt(radius, p.x, p.z, this.player.position.x, this.player.position.z, this.ctx.wind.vector);
      this.sounds.play(kind, p.x, p.y, p.z, loud);
    });

    this.updateBinoculars(dt, view);
    const prompt = this.interact();

    const heading = yawToBearing(this.cam.yaw);
    this.hud.update(dt, {
      heading,
      windFrom: this.ctx.wind.fromBearing,
      windSpeed: this.ctx.wind.speed,
      windLabel: this.ctx.wind.describe(),
      x: this.player.position.x,
      z: this.player.position.z,
      crouched: this.player.crouched,
      inCover: this.player.inCover,
      loudness: this.player.loudness,
      slot: this.slot,
      arrows: this.quiver,
      draw: this.drawing ? this.draw : null,
      aiming: view === "aim",
      binoculars: view === "binoculars" ? this.binoInfo ?? { range: null, subject: null } : null,
      prompt,
      callReady: 1 - clamp(this.callTimer / CALL_COOLDOWN, 0, 1),
    });
  }

  private updateBow(dt: number, view: View): void {
    const input = this.input;
    this.nockTimer -= dt;
    // Losing focus mid-draw eases the string down rather than loosing a stray arrow.
    if (input.interrupted) this.releaseDraw(false);
    if (this.slot !== "bow") {
      this.cam.sway.yaw = this.cam.sway.pitch = 0;
      return;
    }
    if (input.left && !this.drawing) {
      if (this.quiver <= 0) {
        if (!this.emptyWarned) this.hud.toast("Quiver empty", "Pick up your arrows, or restock at camp.", "warn");
        this.emptyWarned = true;
      } else if (this.nockTimer <= 0) {
        this.drawing = true;
        this.draw = 0;
        this.fullFor = 0;
        this.sounds.drawStart();
      }
    }
    if (!input.left) this.emptyWarned = false;

    if (this.drawing) {
      this.draw = Math.min(1, this.draw + dt / DRAW_TIME);
      if (this.draw >= 1) this.fullFor += dt;
      if (input.tapped("KeyQ")) {
        this.releaseDraw(false);
      } else if (!input.left) {
        this.releaseDraw(this.draw > 0.15);
      }
    }

    // Holding at full draw gets harder: the aim begins to wander.
    const tired = Math.max(0, this.fullFor - 2.5);
    const amp = this.drawing ? (0.0015 + Math.min(0.02, tired * 0.005)) * (this.player.crouched ? 0.6 : 1) * (view === "aim" ? 1 : 1.6) : 0;
    this.cam.sway.yaw = amp * this.shake(this.time * 0.9, 1.5);
    this.cam.sway.pitch = amp * this.shake(this.time * 0.9, 8.5);
  }

  private releaseDraw(fire: boolean): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.sounds.drawStop();
    if (fire) this.loose();
    this.draw = 0;
    this.fullFor = 0;
  }

  /** Let the arrow go, converging on whatever is under the crosshair. */
  private loose(): void {
    const cam = this.cam;
    const origin = cam.camera.position.clone();
    const dir = cam.look.clone();
    const aim = castAim(origin, dir, 300, this.ctx.terrain, this.ctx.layout.obstacles, this.wildlife.animals);

    const p = this.player.position;
    const f = forwardOfYaw(this.player.yaw);
    const right = { x: -f.z, z: f.x };
    const from = new THREE.Vector3(
      p.x + f.x * 0.5 + right.x * 0.05,
      p.y + 1.45 - this.woodsman.crouchAmount * 0.45,
      p.z + f.z * 0.5 + right.z * 0.05,
    );
    const shot = aim.point.clone().sub(from).normalize();
    // Never shoot back into your own face when the target is very close.
    if (shot.dot(dir) < 0.5) shot.copy(dir);
    const speed = 22 + 50 * Math.pow(this.draw, 0.8);
    this.arrows.fire(from, shot, speed);
    this.quiver--;
    this.nockTimer = 0.7;
    this.emitFromPlayer("twang", 9);
    this.sounds.play("whoosh", from.x, from.y, from.z, 0.4);
  }

  private updateCall(dt: number): void {
    this.callTimer -= dt;
    if (this.slot !== "call" || !this.input.left || this.callTimer > 0) return;
    this.callTimer = CALL_COOLDOWN;
    this.emitFromPlayer("call", 80);
  }

  private updateBinoculars(dt: number, view: View): void {
    if (view !== "binoculars") {
      this.binoInfo = null;
      return;
    }
    this.binoTimer -= dt;
    if (this.binoTimer > 0 && this.binoInfo) return;
    this.binoTimer = 0.1;
    const aim = castAim(this.cam.camera.position, this.cam.look, 400, this.ctx.terrain, this.ctx.layout.obstacles, this.wildlife.animals);
    const range = aim.distance >= 399 ? null : aim.point.distanceTo(this.player.position);
    this.binoInfo = { range, subject: aim.animal ? `${aim.animal.name} · ${aim.animal.mood}` : null };
  }

  /** What the hunter can reach: an arrow, a fallen animal, or the camp's spare arrows. */
  private interact(): { key: string; text: string } | null {
    const p = this.player.position;
    const animal = this.wildlife.nearestDead(p, 3);
    const arrow = this.arrows.nearestLying(p, 2.2);
    const atCamp = Math.hypot(p.x, p.z) < 4 && this.quiver < QUIVER;
    const pressed = this.input.tapped("KeyE");

    if (animal) {
      if (pressed) this.tag(animal);
      return { key: "E", text: `Tag the ${animal.name.toLowerCase()}` };
    }
    if (arrow) {
      if (pressed) {
        this.arrows.discard(arrow);
        this.quiver++;
        this.sounds.play("pickup", p.x, p.y + 1, p.z, 0.5);
      }
      return { key: "E", text: "Pick up arrow" };
    }
    if (atCamp) {
      if (pressed) {
        this.quiver = QUIVER;
        this.sounds.play("pickup", p.x, p.y + 1, p.z, 0.5);
        this.hud.toast("Quiver refilled", "", "");
      }
      return { key: "E", text: "Refill quiver" };
    }
    return null;
  }

  private tag(a: Animal): void {
    const hit = a.firstHit;
    const distance = hit ? Math.round(hit.distance) : 0;
    const clean = a.arrows.length <= 1;
    const base = a.species.points + distance;
    const points = Math.round(base * (clean ? 1.25 : 1) * (hit?.zone === "body" ? 0.8 : 1));
    this.score += points;
    const note = `${distance} m, ${hit ? ZONE_NOTE[hit.zone] : "found"}${clean ? ", one arrow" : ""}`;
    this.log.push({ name: a.name, points, note });
    this.hud.setLog(this.score, this.log);
    // Arrows come back out of the carcass.
    const back = Math.min(a.arrows.length, QUIVER - this.quiver);
    this.quiver += back;
    this.wildlife.remove(a);
    this.sounds.play("tag", a.position.x, a.position.y + 1, a.position.z, 0.6);
    this.hud.toast(`${a.name} · ${points} pts`, note, "good");
  }

  private onArrowHit(hit: ArrowHit): void {
    const d = Math.round(hit.distance);
    const name = hit.animal.name;
    if (hit.result === "kill") this.hud.toast(`Clean kill`, `${name}, ${d} m, ${ZONE_NOTE[hit.zone]}`, "good");
    else if (hit.result === "mortal") this.hud.toast(`Hit · ${ZONE_NOTE[hit.zone]}`, `The ${name.toLowerCase()} won't go far.`, "warn");
    else this.hud.toast("Wounded", `Follow the blood. ${name}, ${d} m.`, "bad");
  }

  private emitFromPlayer(kind: NoiseKind, radius: number): void {
    const p = this.player.position;
    this.ctx.noise.emit({ x: p.x, y: p.y + 0.3, z: p.z, radius, kind, source: "player", maker: this.player });
  }

  /** Every noise: the animals hear it, the hunter hears it, and if the hunter heard it, it pings. */
  private onNoise(e: NoiseEvent): void {
    this.wildlife.hear(e);
    if (e.source === "player") {
      // Your own noises, at a volume that tells you how loud you are being.
      const vol = e.kind === "call" ? 0.7 : Math.min(0.6, 0.12 + e.radius / 45);
      this.sounds.play(e.kind, e.x, e.y, e.z, vol);
      return;
    }
    const p = this.player.position;
    const loud = loudnessAt(e.radius, e.x, e.z, p.x, p.z, this.ctx.wind.vector);
    if (loud <= 0) return;
    this.hud.ping(e, loud);
    if (e.source !== "arrow") this.sounds.play(e.kind, e.x, e.y, e.z, 0.15 + loud * 0.85);
  }
}
