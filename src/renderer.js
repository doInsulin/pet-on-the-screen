const canvas = document.getElementById("petCanvas");
const ctx = canvas.getContext("2d");

const fallbackProfile = {
  name: "Xiao Budian",
  look: {
    fur: "#fffaf0",
    furLight: "#ffffff",
    furShadow: "#eadfce",
    furWarm: "#f8efd9",
    outline: "#e9ddc9",
    eye: "#171310",
    nose: "#15110f",
    mouth: "#5b4038",
    blush: "#f1a7a2",
    blueToy: "#67aeea",
    blueToyShadow: "#4089ca",
    carrot: "#f28a34",
    carrotLeaf: "#5aa96d",
    rope: "#8b6a53"
  },
  lines: {
    idle: ["I am right here."],
    pat: ["More head pats."],
    cuddle: ["Stay with me."],
    parkour: ["Zoom!"],
    tug: ["Mine."],
    drink: ["Water break."],
    dig: ["Scratch scratch."],
    flop: ["I am flat now."],
    food: ["Meat?"],
    sleep: ["Zzz..."],
    sniff: ["Sniff sniff."]
  },
  personality: { clingy: 0.95, playful: 0.96, naughty: 0.88, sleepyWhenAlone: 0.86, foodMotivated: 0.92 },
  behaviorWeights: { idle: 14, cuddle: 18, parkour: 18, tug: 18, food: 10, sleep: 12, sniff: 8 }
};

let profile = fallbackProfile;
let mood = "idle";
let moodStartedAt = performance.now();
let nextMoodAt = performance.now() + 5000;
let facing = 1;
let xOffset = 0;
let lastWindowNudgeAt = 0;
let eyeFocus = 1;
let lastInteractionAt = performance.now();
let sleepPose = "curl";
let contextualNext = null;
let currentImageIndex = 0;
let lastImageSwapAt = 0;

function colors() {
  return profile.look || fallbackProfile.look;
}

const petImages = [];
const spriteSheet = {
  image: null,
  loaded: false,
  columns: 4,
  rows: 4,
  frameWidth: 0,
  frameHeight: 0
};

const spriteFrames = {
  idle: [0, 12],
  cuddle: [1, 13],
  parkour: [2, 12, 13],
  tug: [3],
  drink: [4],
  dig: [5, 6],
  food: [7],
  sniff: [6],
  flop: [8, 9, 10],
  sleep: [8, 9, 10, 11, 14],
  pat: [0, 2]
};

const needs = {
  energy: 0.72,
  sleepiness: 0.2,
  hunger: 0.3,
  social: 0.55,
  playfulness: 0.76,
  curiosity: 0.62,
  thirst: 0.2,
  calm: 0.46
};

const behaviorDurations = {
  idle: [4200, 7200],
  cuddle: [5600, 9000],
  parkour: [18000, 42000],
  tug: [6500, 9500],
  food: [4500, 6500],
  drink: [5500, 8000],
  dig: [5200, 7600],
  flop: [8000, 14000],
  sleep: [18000, 60000],
  sniff: [4800, 7600],
  pat: [2200, 3200]
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween([min, max]) {
  return min + Math.random() * (max - min);
}

function personality(name, fallback = 0.5) {
  return profile.personality?.[name] ?? fallback;
}

function behaviorBias(name) {
  const weights = profile.behaviorWeights || fallbackProfile.behaviorWeights;
  const value = weights[name] ?? 10;
  return 0.7 + value / 25;
}

function line(kind) {
  const lines = profile.lines?.[kind] || fallbackProfile.lines[kind] || ["..."];
  return lines[Math.floor(Math.random() * lines.length)];
}

function weightedPick(candidates) {
  const total = candidates.reduce((sum, item) => sum + Math.max(0, item.score), 0);
  if (total <= 0) return candidates[0].name;
  let roll = Math.random() * total;
  for (const candidate of candidates) {
    roll -= Math.max(0, candidate.score);
    if (roll <= 0) return candidate.name;
  }
  return candidates[candidates.length - 1].name;
}

function applyNeedDelta(delta) {
  for (const [key, value] of Object.entries(delta)) {
    needs[key] = clamp((needs[key] ?? 0.5) + value);
  }
}

function setMood(next, duration = null) {
  mood = next;
  moodStartedAt = performance.now();
  if (next === "sleep") {
    sleepPose = ["curl", "belly", "sprawl"][Math.floor(Math.random() * 3)];
  } else if (next === "flop") {
    sleepPose = Math.random() > 0.5 ? "sprawl" : "belly";
  }
  nextMoodAt = moodStartedAt + (duration || randomBetween(behaviorDurations[next] || [4000, 7000]));
  if (next === "parkour" || next === "sniff" || next === "food") {
    facing = Math.random() > 0.5 ? 1 : -1;
  }
  line(next);
}

function driftNeeds(dtSeconds) {
  const alone = (performance.now() - lastInteractionAt) / 1000;
  needs.energy = clamp(needs.energy - dtSeconds * (mood === "parkour" ? 0.02 : mood === "tug" ? 0.012 : 0.0012));
  needs.sleepiness = clamp(needs.sleepiness + dtSeconds * (0.0012 + (1 - needs.energy) * 0.0014 + (alone > 90 ? 0.002 : 0)));
  needs.hunger = clamp(needs.hunger + dtSeconds * 0.0009);
  needs.social = clamp(needs.social - dtSeconds * (personality("clingy", 0.8) * 0.0018));
  needs.playfulness = clamp(needs.playfulness + dtSeconds * 0.0006 - (mood === "tug" || mood === "parkour" ? dtSeconds * 0.006 : 0));
  needs.curiosity = clamp(needs.curiosity + dtSeconds * 0.0007 - (mood === "sniff" ? dtSeconds * 0.005 : 0));
  needs.thirst = clamp(needs.thirst + dtSeconds * (mood === "parkour" ? 0.009 : 0.0008) - (mood === "drink" ? dtSeconds * 0.018 : 0));
  needs.calm = clamp(needs.calm + dtSeconds * (mood === "sleep" || mood === "flop" ? 0.005 : 0.0008) - (mood === "parkour" ? dtSeconds * 0.006 : 0));
}

function applyMoodEffects(name) {
  const effects = {
    idle: { curiosity: 0.04, social: -0.02 },
    cuddle: { social: 0.22, calm: 0.12, playfulness: -0.04 },
    parkour: { energy: -0.25, sleepiness: 0.18, thirst: 0.22, playfulness: -0.16, curiosity: -0.05, calm: -0.12 },
    tug: { energy: -0.14, social: 0.14, playfulness: -0.2, sleepiness: 0.07, calm: -0.08 },
    food: { hunger: -0.35, energy: 0.08, playfulness: 0.08, calm: -0.04 },
    drink: { thirst: -0.42, calm: 0.06 },
    sniff: { curiosity: -0.24, hunger: 0.05 },
    dig: { sleepiness: 0.08, calm: 0.12, energy: -0.04 },
    flop: { energy: 0.08, sleepiness: -0.06, calm: 0.16 },
    sleep: { energy: 0.34, sleepiness: -0.42, hunger: 0.05, social: -0.08, calm: 0.22 },
    pat: { social: 0.18, calm: 0.1, playfulness: 0.03 }
  };
  applyNeedDelta(effects[name] || {});
}

function scoreBehaviors() {
  const alone = (performance.now() - lastInteractionAt) / 1000;
  const p = {
    clingy: personality("clingy", 0.8),
    playful: personality("playful", 0.75),
    naughty: personality("naughty", 0.7),
    sleepyWhenAlone: personality("sleepyWhenAlone", 0.65),
    foodMotivated: personality("foodMotivated", 0.75)
  };
  const candidates = [
    { name: "idle", score: 0.45 + needs.calm * 0.4 },
    { name: "cuddle", score: (1 - needs.social) * (1.2 + p.clingy) + (alone > 45 ? 0.4 : 0) },
    { name: "parkour", score: needs.energy * needs.playfulness * (1 + p.playful + p.naughty) * (1 - needs.sleepiness * 0.65) },
    { name: "tug", score: needs.playfulness * (1.2 + p.playful) + (1 - needs.social) * 0.45 },
    { name: "food", score: needs.hunger * (1.1 + p.foodMotivated) + (mood === "sniff" ? 0.2 : 0) },
    { name: "drink", score: needs.thirst * 1.7 + (mood === "parkour" ? 0.3 : 0) },
    { name: "sniff", score: needs.curiosity * 1.35 + needs.hunger * 0.25 },
    { name: "dig", score: needs.sleepiness * 0.75 + (1 - needs.energy) * 0.4 + needs.calm * 0.2 },
    { name: "flop", score: (1 - needs.energy) * 0.75 + needs.sleepiness * 0.42 + needs.calm * 0.35 },
    { name: "sleep", score: needs.sleepiness * (1.2 + p.sleepyWhenAlone * (alone > 90 ? 0.9 : 0.2)) + (1 - needs.energy) * 0.7 }
  ];
  return candidates
    .map((candidate) => ({ ...candidate, score: Math.max(0.03, candidate.score * behaviorBias(candidate.name)) }))
    .filter((candidate) => {
      if (candidate.name === mood) return false;
      if (candidate.name === "sleep" && needs.sleepiness < 0.45 && needs.energy > 0.35) return false;
      if (candidate.name === "parkour" && needs.energy < 0.28) return false;
      if (candidate.name === "drink" && needs.thirst < 0.38) return false;
      return true;
    });
}

function maybeContextualTransition(previousMood) {
  if (previousMood === "parkour" && Math.random() < clamp(needs.thirst + 0.25)) return "drink";
  if ((previousMood === "parkour" || previousMood === "tug") && needs.sleepiness > 0.62 && Math.random() < 0.65) return "flop";
  if ((previousMood === "flop" || previousMood === "dig") && needs.sleepiness > 0.68 && Math.random() < 0.55) return "sleep";
  if (previousMood === "sniff" && needs.hunger > 0.62 && Math.random() < 0.45) return "food";
  return null;
}

function maybeNextMood(now) {
  if (now < nextMoodAt) return;
  const previousMood = mood;
  applyMoodEffects(previousMood);
  let next = contextualNext;
  contextualNext = null;
  if (!next) next = maybeContextualTransition(previousMood);
  if (!next) next = weightedPick(scoreBehaviors());
  setMood(next);
}

function p(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function blob(cx, cy, s, rows, color) {
  for (const [dy, x1, x2] of rows) {
    p(cx + x1 * s, cy + dy * s, (x2 - x1 + 1) * s, s, color);
  }
}

const headRows = [
  [-9, -3, 3], [-8, -5, 5], [-7, -6, 6], [-6, -8, 8], [-5, -9, 9],
  [-4, -10, 10], [-3, -11, 11], [-2, -11, 11], [-1, -12, 12], [0, -12, 12],
  [1, -12, 12], [2, -11, 11], [3, -11, 11], [4, -10, 10], [5, -9, 9],
  [6, -8, 8], [7, -6, 6], [8, -4, 4], [9, -2, 2]
];

const faceRows = [
  [-7, -3, 3], [-6, -6, 6], [-5, -7, 7], [-4, -8, 8], [-3, -9, 9],
  [-2, -9, 9], [-1, -10, 10], [0, -10, 10], [1, -10, 10], [2, -9, 9],
  [3, -8, 8], [4, -7, 7], [5, -5, 5], [6, -3, 3]
];

const bodyRows = [
  [-5, -5, 5], [-4, -7, 7], [-3, -8, 8], [-2, -9, 9], [-1, -10, 10],
  [0, -10, 10], [1, -9, 9], [2, -8, 8], [3, -7, 7], [4, -5, 5]
];

function sparkle(x, y, color) {
  p(x + 2, y, 2, 8, color);
  p(x, y + 2, 8, 2, color);
}

function drawBlueElephant(x, y, t) {
  const c = colors();
  const hop = Math.sin(t / 160) * 2;
  p(x + 8, y + 12 + hop, 18, 14, c.blueToyShadow);
  p(x + 4, y + 8 + hop, 18, 18, c.blueToy);
  p(x + 24, y + 13 + hop, 8, 5, c.blueToy);
  p(x + 1, y + 11 + hop, 7, 10, c.blueToyShadow);
  p(x + 10, y + 14 + hop, 3, 3, "#16334f");
  p(x + 20, y + 25 + hop, 4, 5, c.blueToyShadow);
  p(x + 8, y + 25 + hop, 4, 5, c.blueToyShadow);
}

function drawCarrot(x, y, t) {
  const c = colors();
  const wiggle = Math.sin(t / 130) * 2;
  p(x + 4, y + wiggle, 7, 5, c.carrotLeaf);
  p(x + 10, y + 2 + wiggle, 6, 5, c.carrotLeaf);
  p(x + 8, y + 8 + wiggle, 10, 7, c.carrot);
  p(x + 10, y + 15 + wiggle, 8, 7, c.carrot);
  p(x + 12, y + 22 + wiggle, 5, 6, c.carrot);
  p(x + 10, y + 13 + wiggle, 8, 2, "#ffd2a4");
}

function drawFoodCue(t) {
  const y = 110 + Math.sin(t / 100) * 2;
  p(112, y, 25, 7, "#b95f4f");
  p(116, y - 7, 17, 8, "#f2d8bd");
  p(120, y - 10, 4, 4, "#b94f3f");
  p(128, y - 10, 4, 4, "#b94f3f");
  sparkle(104, y - 20, "#f2b84b");
}

function drawOffscreenTugCue(t) {
  const c = colors();
  const strain = Math.floor((Math.sin(t / 95) + 1) * 2);
  p(123 + strain, 61, 13, 8, c.rope);
  p(136 + strain, 58, 5, 14, "#cfad86");
  p(146 + strain, 54, 3, 3, "#cfad86");
  p(151 + strain, 61, 3, 3, "#cfad86");
}

function drawSleepMarks(t) {
  const phase = Math.floor(t / 420) % 3;
  p(111, 45 - phase * 3, 5, 2, "#5d6fa0");
  p(114, 42 - phase * 3, 6, 2, "#5d6fa0");
  p(111, 39 - phase * 3, 9, 2, "#5d6fa0");
  p(124, 31 - phase * 2, 4, 2, "#5d6fa0");
  p(126, 28 - phase * 2, 5, 2, "#5d6fa0");
}

function drawWaterBowl(t) {
  const shimmer = Math.floor(t / 260) % 2;
  p(105, 119, 30, 7, "#8bb6d8");
  p(109, 114, 22, 7, "#d5efff");
  p(113 + shimmer * 4, 116, 7, 2, "#6bbde9");
  p(123 - shimmer * 3, 117, 5, 2, "#6bbde9");
}

function drawNestMarks(t) {
  const sweep = Math.sin(t / 80) * 6;
  p(43 + sweep, 123, 25, 3, "#d9c3a1");
  p(47 - sweep, 130, 32, 3, "#d9c3a1");
  p(56 + sweep * 0.5, 137, 24, 3, "#d9c3a1");
}

function drawCushion(t) {
  const sink = Math.sin(t / 360) * 1;
  p(36, 122 + sink, 82, 10, "#d6b895");
  p(42, 117 + sink, 68, 8, "#ead4b5");
  p(55, 114 + sink, 16, 3, "#f4e3c9");
}

function nudgeWindowForParkour(t) {
  if (!window.petApi.nudgeWindow || t - lastWindowNudgeAt < 48) return;
  lastWindowNudgeAt = t;
  const horizontal = facing * (mood === "food" ? 9 : 6);
  const vertical = mood === "parkour" ? Math.round(Math.sin(t / 180) * 2) : 0;
  window.petApi.nudgeWindow(horizontal, vertical).catch(() => {});
}

function drawSideRun(t) {
  const c = colors();
  const stride = Math.sin(t / 72);
  const lift = Math.max(0, Math.sin(t / 95)) * 4;
  const headBob = Math.sin(t / 120) * 2;

  ctx.save();
  ctx.translate(80, 88 - lift);
  ctx.scale(facing, 1);
  ctx.rotate(Math.sin(t / 150) * 0.05);

  p(-44, 35, 66, 11, c.outline);
  p(-39, 29, 58, 19, c.outline);
  p(-37, 31, 54, 15, c.fur);
  p(-29, 27, 31, 10, c.furLight);
  p(11, 31, 11, 13, c.furShadow);

  p(15, -3 + headBob, 36, 30, c.outline);
  p(18, 0 + headBob, 31, 25, c.furLight);
  p(42, 8 + headBob, 11, 10, c.furWarm);
  p(33, 5 + headBob, 7, 8, c.eye);
  p(36, 6 + headBob, 2, 2, "#ffffff");
  p(47, 14 + headBob, 5, 4, c.nose);
  p(17, 1 + headBob, 9, 12, c.furShadow);

  p(-50, 23, 13, 12, c.furShadow);
  p(-55, 18, 9, 10, c.furShadow);

  const frontA = stride > 0 ? 1 : -1;
  const frontB = -frontA;
  p(6, 43 + frontA * 3, 9, 24, c.outline);
  p(8, 44 + frontA * 3, 5, 19, c.furShadow);
  p(20, 43 + frontB * 3, 9, 24, c.outline);
  p(22, 44 + frontB * 3, 5, 19, c.furShadow);
  p(-31, 43 + frontB * 3, 9, 24, c.outline);
  p(-29, 44 + frontB * 3, 5, 19, c.furShadow);
  p(-15, 43 + frontA * 3, 9, 24, c.outline);
  p(-13, 44 + frontA * 3, 5, 19, c.furShadow);

  p(50, 10 + headBob, 9, 3, "#f0c15d");
  p(54, 18 + headBob, 11, 3, "#f0c15d");
  ctx.restore();
}

function drawCurledSleep(t) {
  const c = colors();
  ctx.save();
  ctx.translate(80, 90);
  ctx.rotate(-0.05);
  blob(-1, 13, 4, [
    [-6, -5, 5], [-5, -7, 7], [-4, -8, 8], [-3, -9, 9], [-2, -10, 10],
    [-1, -10, 10], [0, -10, 10], [1, -9, 9], [2, -8, 8], [3, -7, 7],
    [4, -5, 5], [5, -3, 3]
  ], c.outline);
  blob(-1, 13, 4, [
    [-5, -5, 5], [-4, -7, 7], [-3, -8, 8], [-2, -9, 9], [-1, -9, 9],
    [0, -9, 9], [1, -8, 8], [2, -7, 7], [3, -6, 6], [4, -4, 4]
  ], c.fur);
  p(-35, 23, 24, 14, c.furShadow);
  p(10, 26, 28, 10, c.furShadow);
  blob(17, -3, 3, headRows.slice(2, 16), c.outline);
  blob(17, -3, 3, faceRows.slice(1, 13), c.furLight);
  p(4, -12, 13, 12, c.furShadow);
  p(24, 1, 11, 2, c.eye);
  p(26, 8, 7, 4, c.nose);
  ctx.restore();
  drawSleepMarks(t);
}

function drawBellySleep(t) {
  const c = colors();
  ctx.save();
  ctx.translate(80, 91);
  p(-35, 12, 70, 33, c.outline);
  p(-31, 15, 62, 27, c.fur);
  p(-19, 19, 38, 17, c.furLight);
  p(-31, -25, 62, 38, c.outline);
  p(-27, -22, 54, 32, c.furLight);
  p(-35, -19, 16, 17, c.furShadow);
  p(20, -19, 16, 17, c.furShadow);
  p(-18, -10, 10, 2, c.eye);
  p(8, -10, 10, 2, c.eye);
  p(-4, -2, 8, 5, c.nose);
  p(-38, 6, 13, 26, c.furShadow);
  p(25, 6, 13, 26, c.furShadow);
  p(-25, 39, 14, 8, c.furShadow);
  p(11, 39, 14, 8, c.furShadow);
  ctx.restore();
  drawSleepMarks(t);
}

function drawSprawlSleep(t) {
  const c = colors();
  drawCushion(t);
  ctx.save();
  ctx.translate(80, 99);
  p(-47, 6, 88, 28, c.outline);
  p(-43, 9, 80, 22, c.fur);
  p(-38, 3, 36, 12, c.furLight);
  p(12, -23, 39, 32, c.outline);
  p(15, -20, 33, 26, c.furLight);
  p(8, -18, 12, 14, c.furShadow);
  p(34, -12, 8, 8, c.eye);
  p(43, -5, 5, 4, c.nose);
  p(-41, 27, 21, 9, c.furShadow);
  p(-8, 27, 21, 9, c.furShadow);
  p(15, 27, 21, 9, c.furShadow);
  ctx.restore();
}

function assetScore(asset, state) {
  const name = asset.name.toLowerCase();
  let score = asset.isCutout ? 8 : 2;
  if (state === "sleep" || state === "flop" || state === "dig") {
    if (name.includes("sleep") || name.includes("睡") || name.includes("躺") || name.includes("趴") || name.includes("3") || name.includes("4")) score += 8;
  } else if (state === "parkour" || state === "food") {
    if (name.includes("stand") || name.includes("站") || name.includes("run") || name.includes("跑") || name.includes("1")) score += 8;
  } else if (state === "tug" || state === "pat" || state === "cuddle") {
    if (name.includes("2") || name.includes("4")) score += 4;
  }
  return score;
}

function pickPetImage(state, t) {
  if (petImages.length === 0) return null;
  if (t - lastImageSwapAt > 12000 || !petImages[currentImageIndex]) {
    const ranked = petImages
      .map((image, index) => ({ index, score: assetScore(image.asset, state) + Math.random() * 2 }))
      .sort((a, b) => b.score - a.score);
    currentImageIndex = ranked[0].index;
    lastImageSwapAt = t;
  }
  return petImages[currentImageIndex];
}

function drawImagePet(t) {
  const item = pickPetImage(mood, t);
  if (!item) return false;

  const age = t - moodStartedAt;
  const base = {
    x: 80,
    y: 83,
    scaleX: facing,
    scaleY: 1,
    rotation: 0,
    alpha: 1
  };

  if (mood === "idle") {
    base.y += Math.sin(t / 420) * 2;
    base.scaleY = 1 + Math.sin(t / 600) * 0.018;
  } else if (mood === "pat") {
    const squash = Math.max(0, 1 - age / 500);
    base.y += 6 * squash;
    base.scaleX *= 1 + 0.08 * squash;
    base.scaleY = 1 - 0.08 * squash;
  } else if (mood === "tug") {
    const pull = Math.max(0, Math.sin(t / 85));
    base.x -= facing * pull * 13;
    base.rotation = -facing * pull * 0.07;
    base.scaleX *= 1 + pull * 0.025;
  } else if (mood === "sleep" || mood === "flop") {
    base.y += 9;
    base.rotation = sleepPose === "belly" ? 0.05 : -0.08;
    base.scaleX *= 1.08;
    base.scaleY = 0.72 + Math.sin(t / 1000) * 0.015;
  } else if (mood === "parkour" || mood === "food") {
    base.y += Math.sin(t / 90) * 4;
    base.rotation = Math.sin(t / 110) * 0.08;
    base.scaleX *= 1.03;
    if (mood === "food") base.scaleY = 1 + Math.max(0, Math.sin(t / 160)) * 0.04;
  } else if (mood === "sniff") {
    base.y += Math.sin(t / 210) * 3;
    base.rotation = facing * 0.04;
  } else if (mood === "dig") {
    base.x += Math.sin(t / 70) * 4;
    base.rotation = Math.sin(t / 90) * 0.05;
  } else if (mood === "cuddle") {
    base.scaleX *= 1.04;
    base.scaleY = 1.04;
  } else if (mood === "drink") {
    base.rotation = 0.05 * facing;
    base.y += 4;
  }

  const maxW = 136;
  const maxH = 138;
  const ratio = Math.min(maxW / item.image.naturalWidth, maxH / item.image.naturalHeight);
  const width = item.image.naturalWidth * ratio;
  const height = item.image.naturalHeight * ratio;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = base.alpha;
  ctx.translate(base.x, base.y);
  ctx.rotate(base.rotation);
  ctx.scale(base.scaleX, base.scaleY);
  ctx.drawImage(item.image, -width / 2, -height / 2, width, height);
  ctx.restore();

  if (mood === "tug") drawOffscreenTugCue(t);
  if (mood === "drink") drawWaterBowl(t);
  if (mood === "dig") drawNestMarks(t);
  if (mood === "food") drawFoodCue(t);
  if (mood === "sleep") drawSleepMarks(t);
  return true;
}

function drawSpritePet(t) {
  if (!spriteSheet.loaded || !spriteSheet.image) return false;

  const frames = spriteFrames[mood] || spriteFrames.idle;
  if (!frames || frames.length === 0) return false;

  const age = t - moodStartedAt;
  const frameSpeed = mood === "parkour" ? 140 : mood === "tug" || mood === "dig" ? 180 : mood === "sleep" || mood === "flop" ? 620 : 360;
  const frame = frames[Math.floor(age / frameSpeed) % frames.length];
  if (frame < 0 || frame >= spriteSheet.columns * spriteSheet.rows || frame === 15) return false;

  const sx = (frame % spriteSheet.columns) * spriteSheet.frameWidth;
  const sy = Math.floor(frame / spriteSheet.columns) * spriteSheet.frameHeight;
  const base = {
    x: 80,
    y: 82,
    scaleX: facing,
    scaleY: 1,
    rotation: 0
  };

  if (mood === "idle" || mood === "cuddle") {
    base.y += Math.sin(t / 430) * 2;
    base.scaleY = 1 + Math.sin(t / 620) * 0.018;
    if (mood === "cuddle") {
      base.scaleX *= 1.03;
      base.scaleY += 0.025;
    }
  } else if (mood === "pat") {
    const squash = Math.max(0, 1 - age / 520);
    base.y += 5 * squash - Math.max(0, Math.sin(t / 110)) * 2;
    base.scaleX *= 1 + 0.07 * squash;
    base.scaleY = 1 - 0.075 * squash;
  } else if (mood === "tug") {
    const pull = Math.max(0, Math.sin(t / 85));
    base.x -= facing * pull * 11;
    base.rotation = -facing * pull * 0.07;
    base.scaleX *= 1 + pull * 0.02;
  } else if (mood === "parkour") {
    base.y += Math.sin(t / 82) * 5;
    base.rotation = Math.sin(t / 105) * 0.075;
    base.scaleX *= 1.02;
    nudgeWindowForParkour(t);
  } else if (mood === "food") {
    base.y += Math.sin(t / 95) * 4 - Math.max(0, Math.sin(t / 150)) * 3;
    base.rotation = Math.sin(t / 130) * 0.05;
    base.scaleY = 1 + Math.max(0, Math.sin(t / 150)) * 0.04;
  } else if (mood === "sleep" || mood === "flop") {
    base.y += 13;
    base.rotation = mood === "flop" || sleepPose === "sprawl" ? -0.07 : 0.03;
    base.scaleX *= 1.06;
    base.scaleY = 0.78 + Math.sin(t / 1050) * 0.014;
  } else if (mood === "sniff") {
    base.x += facing * Math.sin(t / 180) * 2;
    base.y += Math.sin(t / 220) * 2;
    base.rotation = facing * 0.035;
  } else if (mood === "dig") {
    base.x += Math.sin(t / 68) * 4;
    base.y += Math.sin(t / 130) * 2;
    base.rotation = Math.sin(t / 90) * 0.05;
  } else if (mood === "drink") {
    base.y += 5;
    base.rotation = facing * 0.035;
  }

  const maxW = 136;
  const maxH = 136;
  const ratio = Math.min(maxW / spriteSheet.frameWidth, maxH / spriteSheet.frameHeight);
  const width = spriteSheet.frameWidth * ratio;
  const height = spriteSheet.frameHeight * ratio;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(base.x, base.y);
  ctx.rotate(base.rotation);
  ctx.scale(base.scaleX, base.scaleY);
  ctx.drawImage(
    spriteSheet.image,
    sx,
    sy,
    spriteSheet.frameWidth,
    spriteSheet.frameHeight,
    -width / 2,
    -height / 2,
    width,
    height
  );
  ctx.restore();

  if (mood === "tug") drawOffscreenTugCue(t);
  if (mood === "drink") drawWaterBowl(t);
  if (mood === "dig") drawNestMarks(t);
  if (mood === "food") drawFoodCue(t);
  if (mood === "sleep") drawSleepMarks(t);
  return true;
}

function drawCanvasDog(t) {
  const c = colors();
  const age = t - moodStartedAt;
  const bounce = mood === "sleep" || mood === "flop" ? 0 : Math.sin(t / 210) * 2;
  const run = mood === "parkour" || mood === "food";
  const pat = mood === "pat" ? Math.max(0, 1 - age / 600) * 4 : 0;
  const tugPull = mood === "tug" ? Math.max(0, Math.sin(t / 90)) * 12 : 0;
  const dig = mood === "dig" ? Math.sin(t / 65) * 5 : 0;

  if (run) {
    xOffset *= 0.88;
    nudgeWindowForParkour(t);
  } else if (mood === "cuddle") {
    xOffset += (0 - xOffset) * 0.09;
  } else if (mood === "tug") {
    xOffset = -tugPull * facing;
  } else {
    xOffset *= 0.92;
  }

  if (mood === "sleep" || mood === "flop") {
    if (sleepPose === "belly") drawBellySleep(t);
    else if (sleepPose === "sprawl" || mood === "flop") drawSprawlSleep(t);
    else drawCurledSleep(t);
    return;
  }

  if (run) {
    drawSideRun(t);
    if (mood === "food") drawFoodCue(t);
    return;
  }

  ctx.save();
  ctx.translate(80 + xOffset + dig * 0.3, 80 + bounce + pat);
  ctx.scale(facing, 1);

  blob(0, 34, 3, bodyRows, c.outline);
  blob(0, 34, 3, bodyRows.slice(1, -1), c.fur);
  const pawSpeed = mood === "dig" ? 55 : 130;
  const frontPaw = Math.sin(t / pawSpeed) * (mood === "dig" ? 8 : 3);
  p(-27, 44 + frontPaw, 11, 17, c.outline);
  p(-24, 44 + frontPaw, 6, 13, c.furShadow);
  p(17, 44 - frontPaw, 11, 17, c.outline);
  p(20, 44 - frontPaw, 6, 13, c.furShadow);

  blob(0, -12, 3, headRows, c.outline);
  blob(0, -12, 3, faceRows, c.furLight);
  p(-34, -24, 17, 21, c.outline);
  p(-31, -21, 14, 17, c.furShadow);
  p(18, -24, 17, 21, c.outline);
  p(18, -21, 14, 17, c.furShadow);
  const tugFocus = mood === "tug" ? eyeFocus : 0;
  p(-20, -19, 10, 11, c.eye);
  p(10, -19, 10, 11, c.eye);
  p(-17 + tugFocus, -17, 3, 3, "#ffffff");
  p(13 + tugFocus, -17, 3, 3, "#ffffff");
  p(-5, -5, 10, 7, c.nose);
  p(-7, 5, 5, 3, c.mouth);
  p(2, 5, 5, 3, c.mouth);
  p(-27, -2, 9, 6, c.blush);
  p(18, -2, 9, 6, c.blush);
  p(-12, 20, 24, 6, c.furWarm);

  if (mood === "cuddle") {
    p(-39, 5, 9, 6, c.furShadow);
    p(30, 5, 9, 6, c.furShadow);
    p(-47, -36, 4, 4, "#ef7676");
    p(-42, -36, 4, 4, "#ef7676");
    p(-45, -32, 7, 5, "#ef7676");
  }

  if (mood === "tug") {
    p(25, -7, 16, 6, c.furShadow);
    p(31, -1, 15, 6, c.furShadow);
    p(20, 4, 16, 5, c.mouth);
    p(31, 1, 7, 5, "#ffffff");
  }

  ctx.restore();

  if (mood === "tug") drawOffscreenTugCue(t);
  if (mood === "drink") drawWaterBowl(t);
  if (mood === "dig") drawNestMarks(t);
  if (mood === "idle" && Math.sin(t / 900) > 0.55) drawCarrot(116, 94, t);
  if (mood === "sniff") {
    p(42, 106 + Math.sin(t / 170) * 2, 4, 4, "#d8b483");
    p(35, 112 + Math.sin(t / 170) * 2, 5, 3, "#d8b483");
  }
}

function draw(t) {
  const dtSeconds = Math.min(0.08, (t - (draw.lastT || t)) / 1000);
  draw.lastT = t;
  driftNeeds(dtSeconds);
  maybeNextMood(t);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!drawSpritePet(t) && !drawImagePet(t)) {
    ctx.imageSmoothingEnabled = false;
    drawCanvasDog(t);
  }
  requestAnimationFrame(draw);
}

function loadImageAsset(asset) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ asset, image });
    image.onerror = () => resolve(null);
    image.src = asset.url;
  });
}

async function loadPetImages() {
  try {
    if (!window.petApi.listAssets) return false;
    const assets = await window.petApi.listAssets();
    const imageAssets = assets
      .filter((asset) => asset.type === "image")
      .sort((a, b) => Number(b.isCutout) - Number(a.isCutout));
    const loaded = await Promise.all(imageAssets.map(loadImageAsset));
    petImages.splice(0, petImages.length, ...loaded.filter(Boolean));
    return petImages.length > 0;
  } catch {
    return false;
  }
}

function loadSpriteSheet() {
  return new Promise((resolve) => {
    try {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          resolve(false);
          return;
        }
        spriteSheet.image = image;
        spriteSheet.loaded = true;
        spriteSheet.frameWidth = image.naturalWidth / spriteSheet.columns;
        spriteSheet.frameHeight = image.naturalHeight / spriteSheet.rows;
        resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = "../参考/gpt_generate比熊.png";
    } catch {
      resolve(false);
    }
  });
}

async function loadProfile() {
  try {
    const response = await fetch("./pet-profile.json");
    profile = await response.json();
  } catch {
    profile = fallbackProfile;
  }
  line("idle");
}

function interact(kind) {
  lastInteractionAt = performance.now();
  if (kind === "pat") {
    applyNeedDelta({ social: 0.18, calm: 0.1, playfulness: 0.03, sleepiness: -0.03 });
    setMood("pat", 2600);
  } else if (kind === "tug") {
    applyNeedDelta({ social: 0.14, playfulness: -0.18, energy: -0.1, sleepiness: 0.06, calm: -0.06 });
    setMood("tug", 7600);
  } else if (kind === "parkour") {
    applyNeedDelta({ playfulness: 0.14, energy: 0.08, calm: -0.08 });
    setMood("parkour", 22000);
  } else if (kind === "sleep") {
    applyNeedDelta({ sleepiness: 0.25, calm: 0.12 });
    setMood("sleep", 30000);
  }
}

canvas.addEventListener("click", () => interact("pat"));
canvas.addEventListener("dblclick", () => interact("tug"));
canvas.addEventListener("auxclick", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "p") interact("parkour");
  if (key === "s") interact("sleep");
  if (key === "t") interact("tug");
});
canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  eyeFocus = event.clientX > rect.left + rect.width / 2 ? 2 : -1;
});
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.petApi.quit();
});

if (window.petApi.onPetAction) {
  window.petApi.onPetAction((action) => {
    if (action === "play") interact("tug");
    if (action === "sleep") interact("sleep");
  });
}

loadProfile().then(async () => {
  await Promise.allSettled([loadSpriteSheet(), loadPetImages()]);
  setMood("idle");
  requestAnimationFrame(draw);
});
