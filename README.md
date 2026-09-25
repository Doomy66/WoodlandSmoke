# Woodland Smoke

A third-person hunting game in the browser. You are a woodsman with a longbow
and a quiver of twelve arrows, in a misty wood full of red deer, wild boar and
rabbits that can see you, hear you and smell you.

The hunter, the animals, the trees and every sound are made in code. The
ground, oak and spruce bark and rock surfaces are photographed textures from
[Poly Haven](https://polyhaven.com), released CC0 into the public domain, in
`public/textures`.

## Play

```bash
npm install
npm run dev
```

Then open http://localhost:5175 and click to begin. The mouse is captured while
you play; press Esc to pause.

| Action | Control |
| --- | --- |
| Look | Mouse |
| Aim the bow, or look through the glass | Hold right button |
| Draw, then loose | Hold left button, release |
| Ease the string down without shooting | Q |
| Move | W A S D |
| Run (loud) | Shift |
| Crouch | C |
| Bow, glass, deer call | 1 2 3, or mouse wheel |
| Pick up an arrow, tag an animal, refill at camp | E |
| Mute | M |

The camera follows from behind. At a walk the hunter stalks, low on bent
knees with the bow held ready; hold Shift and he runs, loudly.

## The HUD

- **Compass** along the top. Pings show on it at the bearing of any sound you
  heard, and it marks where the wind is coming from.
- **Wind** at top right: which way it blows across you, how fast, and its name
  on the Beaufort scale. Streaks drift faster as the wind picks up.
- **Heard nearby** at bottom left: a ring 80 metres across, facing where you
  look. Anything in the wood that makes a noise you could hear leaves a ping at
  the spot it came from, and the ping fades over a few seconds. Amber is an
  animal moving or feeding, red is an alarm call or something crashing away,
  pale blue is one of your arrows landing.
- **Kit** at bottom right: what is in hand, arrows left, standing or crouched,
  whether you are hidden in a bush, and a meter of how much noise you are
  making.

## How the hunt works

Each animal has an awareness that rises with what it senses and drains away
when the wood goes quiet. As it rises the animal stops, stares, stamps and
snorts. When it gets high enough the animal bolts and sounds an alarm, and the
rest of the herd runs with it.

- **Scent** blows downwind in a plume. An animal inside it knows you are there
  long before it sees you. Keep the wind in your face.
- **Sight** is mostly for movement. Crouching, keeping still and standing in a
  bush all cut how far away you can be seen. Trunks block the view.
- **Sound** from footsteps carries 3 metres crouched, 11 walking and 26
  running. Sound carries further downwind. Twigs lie in dry patches; snap one
  and it carries 30 metres.

Arrows fall with gravity and drift with the wind, so a long shot needs holding
over and aiming upwind. The glass has a rangefinder. Hold at full draw too
long and the aim begins to wander.

Shot placement matters. A head shot drops the animal where it stands. Heart
and lungs kill within seconds, though the animal may run a few metres first. A
body shot wounds it: the animal runs, bleeds and leaves a trail you can follow.
Tag a fallen animal for points. Longer shots and one-arrow kills score more.
Arrows come back out of anything you tag, and the camp refills your quiver.

The deer call brings calm deer toward you. Once they have been spooked they
ignore it.

Add `?seed=` and a number to the address to grow a different wood.

## Development

```bash
npm test
npm run build
```

Built with [Three.js](https://threejs.org), Vite and TypeScript. Pushes to
`main` build and publish to GitHub Pages through `.github/workflows/deploy.yml`.
