import { bearingOf, compassPoint, wrapDegrees } from "../core/math";
import type { NoiseEvent, NoiseKind } from "../sound/noise";
import "./style.css";

export type Slot = "bow" | "binoculars" | "call";
export const SLOTS: readonly Slot[] = ["bow", "binoculars", "call"];

export interface HudState {
  /** Compass bearing the camera faces. */
  heading: number;
  windFrom: number;
  windSpeed: number;
  windLabel: string;
  x: number;
  z: number;
  crouched: boolean;
  inCover: boolean;
  loudness: number;
  slot: Slot;
  arrows: number;
  /** 0..1 draw, or null when the string is not being pulled. */
  draw: number | null;
  aiming: boolean;
  binoculars: { range: number | null; subject: string | null } | null;
  prompt: { key: string; text: string } | null;
  callReady: number;
}

interface Ping { x: number; z: number; born: number; life: number; size: number; color: string }

/** How long a ping lingers, seconds. */
export const PING_LIFE = 5;
/** Radar reach, metres. */
const RADAR_RANGE = 80;

const ALARMS: NoiseKind[] = ["bark", "snort", "thump", "grunt", "crash"];

/** A ping's opacity, from bright to gone over its life. */
export function pingAlpha(age: number, life = PING_LIFE): number {
  if (age < 0 || age >= life) return 0;
  const t = age / life;
  return (1 - t) * (1 - t);
}

const icons: Record<Slot, string> = {
  bow: '<svg viewBox="0 0 32 32"><path d="M9 3c10 4 10 22 0 26"/><path d="M9 3v26" stroke-width="1"/><path d="M5 16h22M23 13l4 3-4 3"/></svg>',
  binoculars: '<svg viewBox="0 0 32 32"><circle cx="9" cy="20" r="6"/><circle cx="23" cy="20" r="6"/><path d="M12 14l2-7h4l2 7M14 18h4"/></svg>',
  call: '<svg viewBox="0 0 32 32"><path d="M4 18c6 0 12-6 16-10l4 2c-2 6-2 10 0 16l-4 2c-4-4-10-8-16-8z"/><path d="M26 12c2 2 2 6 0 8"/></svg>',
};
const names: Record<Slot, string> = { bow: "Bow", binoculars: "Glass", call: "Call" };

/**
 * The heads-up display: a compass strip, a wind gauge, a ring that shows
 * where sounds came from, what is in hand, and how much noise you are
 * making. Pings are anchored to where the sound was made, so they stay put
 * as you turn and walk, and fade over a few seconds.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly compass: HTMLCanvasElement;
  private readonly windCanvas: HTMLCanvasElement;
  private readonly radar: HTMLCanvasElement;
  private readonly cross: HTMLCanvasElement;
  private readonly windSpeed: HTMLElement;
  private readonly windDesc: HTMLElement;
  private readonly score: HTMLElement;
  private readonly logList: HTMLElement;
  private readonly slots: Record<Slot, HTMLElement>;
  private readonly arrowsEl: HTMLElement;
  private readonly meter: HTMLElement[];
  private readonly stance: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly binos: HTMLElement;
  private readonly binoRange: HTMLElement;
  private readonly binoSubject: HTMLElement;
  private readonly pings: Ping[] = [];
  private time = 0;
  private lastPrompt = "";

  constructor(parent: HTMLElement) {
    this.root = el("div", "hud hidden");
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <canvas id="compass"></canvas>
      <div id="log" class="panel"><div class="label">Hunting log</div><div class="score">0</div><ul></ul></div>
      <div id="wind" class="panel"><div class="label">Wind</div><canvas></canvas><div class="speed"></div><div class="desc"></div></div>
      <div id="radar" class="panel"><canvas></canvas><div class="label">Heard nearby</div></div>
      <div id="kit" class="panel">
        <div class="slots">${SLOTS.map((s, i) => `<div class="slot" data-slot="${s}"><span class="key">${i + 1}</span>${icons[s]}<span>${names[s]}</span></div>`).join("")}</div>
        <div class="status">
          <div class="stance"></div>
          <div class="meter">${Array.from({ length: 10 }, (_, i) => `<i style="height:${5 + i}px"></i>`).join("")}</div>
          <div class="arrows"><b>0</b> arrows</div>
        </div>
      </div>
      <div id="binos"><div class="mask"></div><div class="readout"><div class="range">— m</div><div class="subject"></div></div></div>
      <canvas id="crosshair"></canvas>
      <div id="prompt" class="panel"></div>
      <div id="toasts"></div>`;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.compass = q("#compass");
    this.windCanvas = q("#wind canvas");
    this.radar = q("#radar canvas");
    this.cross = q("#crosshair");
    this.windSpeed = q("#wind .speed");
    this.windDesc = q("#wind .desc");
    this.score = q("#log .score");
    this.logList = q("#log ul");
    this.slots = Object.fromEntries(SLOTS.map((s) => [s, q(`.slot[data-slot="${s}"]`)])) as Record<Slot, HTMLElement>;
    this.arrowsEl = q(".arrows b");
    this.meter = Array.from(this.root.querySelectorAll<HTMLElement>(".meter i"));
    this.stance = q(".stance");
    this.prompt = q("#prompt");
    this.toasts = q("#toasts");
    this.binos = q("#binos");
    this.binoRange = q("#binos .range");
    this.binoSubject = q("#binos .subject");
  }

  show(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  /** A sound the hunter heard: put a ping where it came from. */
  ping(e: NoiseEvent, loudness: number): void {
    const color = e.source === "arrow" ? "var(--hud-arrow)" : ALARMS.includes(e.kind) ? "var(--hud-alarm)" : "var(--hud-amber)";
    this.pings.push({ x: e.x, z: e.z, born: this.time, life: PING_LIFE * (0.6 + loudness * 0.6), size: 2.5 + loudness * 4, color });
    if (this.pings.length > 60) this.pings.shift();
  }

  toast(text: string, detail = "", kind: "good" | "warn" | "bad" | "" = ""): void {
    const t = el("div", `toast ${kind}`);
    t.textContent = text;
    if (detail) {
      const s = document.createElement("small");
      s.textContent = detail;
      t.appendChild(s);
    }
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3700);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
  }

  setLog(score: number, entries: { name: string; points: number; note: string }[]): void {
    this.score.textContent = String(score);
    this.logList.innerHTML = "";
    for (const e of entries.slice(-5).reverse()) {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = e.name;
      li.append(b, ` · ${e.points} · ${e.note}`);
      this.logList.appendChild(li);
    }
  }

  update(dt: number, s: HudState): void {
    this.time += dt;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      if (this.time - this.pings[i]!.born > this.pings[i]!.life) this.pings.splice(i, 1);
    }
    const colors = resolveColors(this.root);
    this.drawCompass(s, colors);
    this.drawWind(s, colors);
    this.drawRadar(s, colors);
    this.drawCrosshair(s, colors);

    this.windSpeed.textContent = `${s.windSpeed.toFixed(1)} m/s from ${compassPoint(s.windFrom)}`;
    this.windDesc.textContent = s.windLabel;
    for (const slot of SLOTS) this.slots[slot].classList.toggle("on", slot === s.slot);
    this.arrowsEl.textContent = String(s.arrows);
    const lit = Math.round(s.loudness * 10);
    this.meter.forEach((m, i) => {
      m.className = i < lit ? `lit${i >= 7 ? " hot" : i >= 4 ? " mid" : ""}` : "";
    });
    const stanceHtml = `${s.crouched
      ? '<svg viewBox="0 0 18 18"><circle cx="9" cy="5" r="2"/><path d="M9 7l-1 5h4l1 4M8 12l-3 4"/></svg>Crouched'
      : '<svg viewBox="0 0 18 18"><circle cx="9" cy="3" r="2"/><path d="M9 5v7M9 12l-3 5M9 12l3 5M5 8h8"/></svg>Standing'}${s.inCover ? ' <span class="tag cover">Hidden</span>' : ""}`;
    if (this.stance.innerHTML !== stanceHtml) this.stance.innerHTML = stanceHtml;

    const promptHtml = s.prompt ? `<kbd>${s.prompt.key}</kbd>${escapeHtml(s.prompt.text)}` : "";
    if (promptHtml !== this.lastPrompt) {
      this.lastPrompt = promptHtml;
      if (promptHtml) this.prompt.innerHTML = promptHtml;
      this.prompt.classList.toggle("show", !!promptHtml);
    }

    this.binos.classList.toggle("show", !!s.binoculars);
    if (s.binoculars) {
      this.binoRange.textContent = s.binoculars.range === null ? "— m" : `${Math.round(s.binoculars.range)} m`;
      this.binoSubject.textContent = s.binoculars.subject ?? "";
    }
  }

  private drawCompass(s: HudState, c: Colors): void {
    const g = fit(this.compass);
    if (!g) return;
    const w = this.compass.clientWidth, h = this.compass.clientHeight;
    g.clearRect(0, 0, w, h);
    // Soft band behind the strip, fading at both ends.
    const band = g.createLinearGradient(0, 0, w, 0);
    band.addColorStop(0, "rgba(18,22,16,0)");
    band.addColorStop(0.15, "rgba(18,22,16,0.45)");
    band.addColorStop(0.85, "rgba(18,22,16,0.45)");
    band.addColorStop(1, "rgba(18,22,16,0)");
    g.fillStyle = band;
    g.fillRect(0, 6, w, 30);

    const span = 150;
    const px = (b: number) => w / 2 + (wrapDiff(b, s.heading) / span) * w;
    const fade = (x: number) => Math.max(0, 1 - Math.abs(x - w / 2) / (w / 2)) ** 0.6;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let b = 0; b < 360; b += 5) {
      const x = px(b);
      if (x < 0 || x > w) continue;
      g.globalAlpha = fade(x);
      const major = b % 45 === 0;
      const mid = b % 15 === 0;
      g.strokeStyle = c.ink;
      g.lineWidth = major ? 2 : 1;
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x, major ? 22 : mid ? 26 : 29);
      g.stroke();
      if (major) {
        g.fillStyle = b === 0 ? c.alarm : c.ink;
        g.font = "600 14px Inter, system-ui, sans-serif";
        g.fillText(compassPoint(b), x, 13);
      } else if (mid) {
        g.fillStyle = c.dim;
        g.font = "10px Inter, system-ui, sans-serif";
        g.fillText(String(b), x, 14);
      }
    }
    // Where the wind comes from.
    const wx = px(s.windFrom);
    if (wx > 0 && wx < w) {
      g.globalAlpha = fade(wx);
      g.fillStyle = c.arrow;
      g.font = "600 10px Inter, system-ui, sans-serif";
      g.fillText("WIND", wx, 44);
    }
    // Pings along the strip, at their bearing.
    for (const p of this.pings) {
      const b = bearingOf(p.x - s.x, p.z - s.z);
      const x = px(b);
      if (x < 0 || x > w) continue;
      g.globalAlpha = pingAlpha(this.time - p.born, p.life) * fade(x);
      g.fillStyle = cssColor(p.color, c);
      g.beginPath();
      g.arc(x, 38, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // Heading marker.
    g.fillStyle = c.amber;
    g.beginPath();
    g.moveTo(w / 2 - 6, 36);
    g.lineTo(w / 2 + 6, 36);
    g.lineTo(w / 2, 30);
    g.fill();
    g.font = "600 11px Inter, system-ui, sans-serif";
    g.fillText(`${Math.round(s.heading) % 360}°`, w / 2, 46);
  }

  private drawWind(s: HudState, c: Colors): void {
    const g = fit(this.windCanvas);
    if (!g) return;
    const w = this.windCanvas.clientWidth;
    const r = w / 2 - 6, cx = w / 2, cy = w / 2;
    g.clearRect(0, 0, w, w);
    g.strokeStyle = c.faint;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    // North on the ring, turning as you turn.
    const north = (-s.heading * Math.PI) / 180;
    g.fillStyle = c.alarm;
    g.font = "600 10px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N", cx + Math.sin(north) * (r - 9), cy - Math.cos(north) * (r - 9));
    // You, facing up.
    g.fillStyle = c.ink;
    g.beginPath();
    g.moveTo(cx, cy - 6);
    g.lineTo(cx + 4, cy + 4);
    g.lineTo(cx - 4, cy + 4);
    g.fill();
    // The wind, blowing across the dial the way it blows across you.
    const toward = ((s.windFrom + 180 - s.heading) * Math.PI) / 180;
    const len = r * 0.85;
    const tx = Math.sin(toward), ty = -Math.cos(toward);
    const strength = Math.min(1, s.windSpeed / 8);
    g.strokeStyle = c.arrow;
    g.fillStyle = c.arrow;
    g.lineWidth = 2 + strength * 2;
    // Streaks drifting along the wind: faster wind, faster streaks.
    const drift = (this.time * (0.3 + s.windSpeed * 0.12)) % 1;
    for (const off of [-0.45, 0, 0.45]) {
      const ox = -ty * off * r, oy = tx * off * r;
      const a = ((drift + Math.abs(off)) % 1) * 2 - 1;
      const x0 = cx + ox + tx * (a - 0.35) * len, y0 = cy + oy + ty * (a - 0.35) * len;
      const x1 = cx + ox + tx * (a + 0.05) * len, y1 = cy + oy + ty * (a + 0.05) * len;
      g.globalAlpha = (1 - Math.abs(a)) * 0.6;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 2 + strength * 2;
    g.beginPath();
    g.moveTo(cx - tx * len, cy - ty * len);
    g.lineTo(cx + tx * (len - 8), cy + ty * (len - 8));
    g.stroke();
    g.beginPath();
    g.moveTo(cx + tx * len, cy + ty * len);
    g.lineTo(cx + tx * (len - 12) - ty * 7, cy + ty * (len - 12) + tx * 7);
    g.lineTo(cx + tx * (len - 12) + ty * 7, cy + ty * (len - 12) - tx * 7);
    g.fill();
  }

  private drawRadar(s: HudState, c: Colors): void {
    const g = fit(this.radar);
    if (!g) return;
    const w = this.radar.clientWidth;
    const cx = w / 2, cy = w / 2, r = w / 2 - 4;
    g.clearRect(0, 0, w, w);
    g.lineWidth = 1;
    for (const f of [1, 2 / 3, 1 / 3]) {
      g.strokeStyle = f === 1 ? c.dim : c.faint;
      g.beginPath();
      g.arc(cx, cy, r * f, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = c.faint;
    g.font = "9px Inter, system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(`${Math.round(RADAR_RANGE / 3)}m`, cx + 3, cy - r / 3 + 10);
    g.fillText(`${Math.round((RADAR_RANGE * 2) / 3)}m`, cx + 3, cy - (r * 2) / 3 + 10);
    // Forward cone.
    g.fillStyle = "rgba(241,234,216,0.05)";
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, r, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    g.fill();
    // North tick on the rim.
    const north = (-s.heading * Math.PI) / 180;
    g.fillStyle = c.alarm;
    g.font = "600 10px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N", cx + Math.sin(north) * (r - 8), cy - Math.cos(north) * (r - 8));

    const scale = r / RADAR_RANGE;
    for (const p of this.pings) {
      const dx = p.x - s.x, dz = p.z - s.z;
      let d = Math.hypot(dx, dz);
      const rel = ((bearingOf(dx, dz) - s.heading) * Math.PI) / 180;
      const edge = d > RADAR_RANGE;
      if (edge) d = RADAR_RANGE;
      const x = cx + Math.sin(rel) * d * scale, y = cy - Math.cos(rel) * d * scale;
      const age = this.time - p.born;
      const alpha = pingAlpha(age, p.life);
      const col = cssColor(p.color, c);
      // An expanding ring, then a dot that fades.
      const ring = Math.min(1, age / 0.9);
      g.globalAlpha = alpha * (1 - ring);
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, p.size + ring * 14, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = alpha;
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, edge ? p.size * 0.7 : p.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = c.ink;
    g.beginPath();
    g.moveTo(cx, cy - 7);
    g.lineTo(cx + 5, cy + 5);
    g.lineTo(cx, cy + 2);
    g.lineTo(cx - 5, cy + 5);
    g.fill();
  }

  private drawCrosshair(s: HudState, c: Colors): void {
    const g = fit(this.cross);
    if (!g) return;
    const w = this.cross.clientWidth;
    const cx = w / 2, cy = w / 2;
    g.clearRect(0, 0, w, w);
    if (s.binoculars) {
      g.strokeStyle = "rgba(0,0,0,0.6)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx - 40, cy); g.lineTo(cx - 6, cy);
      g.moveTo(cx + 6, cy); g.lineTo(cx + 40, cy);
      g.moveTo(cx, cy - 40); g.lineTo(cx, cy - 6);
      g.moveTo(cx, cy + 6); g.lineTo(cx, cy + 40);
      g.stroke();
      return;
    }
    if (s.slot !== "bow") {
      g.fillStyle = c.dim;
      g.beginPath();
      g.arc(cx, cy, 1.5, 0, Math.PI * 2);
      g.fill();
      if (s.slot === "call" && s.callReady < 1) {
        g.strokeStyle = c.amber;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx, cy, 14, -Math.PI / 2, -Math.PI / 2 + s.callReady * Math.PI * 2);
        g.stroke();
      }
      return;
    }
    const drawing = s.draw !== null;
    const gap = drawing ? 10 - (s.draw ?? 0) * 6 : s.aiming ? 7 : 10;
    g.strokeStyle = c.ink;
    g.lineWidth = 1.5;
    g.globalAlpha = s.aiming || drawing ? 0.95 : 0.6;
    g.beginPath();
    g.moveTo(cx - gap - 8, cy); g.lineTo(cx - gap, cy);
    g.moveTo(cx + gap, cy); g.lineTo(cx + gap + 8, cy);
    g.moveTo(cx, cy + gap); g.lineTo(cx, cy + gap + 8);
    g.stroke();
    g.fillStyle = c.ink;
    g.beginPath();
    g.arc(cx, cy, 1.4, 0, Math.PI * 2);
    g.fill();
    if (drawing) {
      const d = s.draw ?? 0;
      g.globalAlpha = 0.9;
      g.strokeStyle = d >= 0.999 ? c.good : c.amber;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, 26, Math.PI * 0.75, Math.PI * 0.75 + d * Math.PI * 1.5);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}

interface Colors { ink: string; dim: string; faint: string; amber: string; alarm: string; arrow: string; good: string }

let cachedColors: Colors | null = null;
function resolveColors(root: HTMLElement): Colors {
  if (cachedColors) return cachedColors;
  const cs = getComputedStyle(root);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  cachedColors = {
    ink: v("--hud-ink"), dim: v("--hud-dim"), faint: v("--hud-faint"), amber: v("--hud-amber"),
    alarm: v("--hud-alarm"), arrow: v("--hud-arrow"), good: v("--hud-good"),
  };
  return cachedColors;
}

function cssColor(value: string, c: Colors): string {
  if (value.includes("alarm")) return c.alarm;
  if (value.includes("arrow")) return c.arrow;
  return c.amber;
}

/** Size a canvas's backing store to its CSS size at the screen's pixel ratio. */
function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function wrapDiff(b: number, heading: number): number {
  const d = wrapDegrees(b - heading);
  return d > 180 ? d - 360 : d;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
