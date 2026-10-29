#!/usr/bin/env node
/** Deterministic headless voiceover carve for Harmonia compositions. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyseCarveBands, analyseCarveDuck, analyseCarveDynamics, carveBandsToChain, carveProfile, mixCarveSources } from "@hyperframes/core/audio-carve";
import { defaultAudioFxParams, mintAudioFxNodeId, serializeAudioFxChain } from "@hyperframes/core/audio-fx";

const SAMPLE_RATE = 48000;
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`${flag} is required`);
  return args[index + 1];
};
const compPath = resolve(value("--comp"));
const strength = Number(args.includes("--strength") ? value("--strength") : "0.25");
if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error("invalid carve strength");
const sourceHtml = readFileSync(compPath, "utf8");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] ?? null;
const unescape = (text) => text.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const tags = [...sourceHtml.matchAll(/<(audio|video)\b[^>]*>/gi)].map((match) => match[0]);
const bedTag = tags.find((tag) => attr(tag, "data-fx-carve") !== null);
if (!bedTag) throw new Error("composition has no music bed marked for carving");
const settings = JSON.parse(unescape(attr(bedTag, "data-fx-carve")));
const bedId = attr(bedTag, "id");
const sources = new Set(settings.sources ?? []);
const voiceTags = tags.filter((tag) => tag !== bedTag && (sources.has(attr(tag, "id")) || sources.has(attr(tag, "data-audio-group"))));
if (voiceTags.length === 0) throw new Error("carve has no matching voice sources");
const start = (tag) => Number(attr(tag, "data-start") ?? 0);
const decode = (tag) => {
  const source = attr(tag, "src");
  if (!source) throw new Error("carve source has no src");
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", resolve(dirname(compPath), unescape(source)), "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (raw.length === 0) throw new Error(`no audio decoded from ${source}`);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
};
const voice = mixCarveSources(voiceTags.map((tag) => ({ samples: decode(tag), offsetSeconds: start(tag) - start(bedTag) })), SAMPLE_RATE);
if (voice.length === 0) throw new Error("voice does not overlap the music bed");
const profile = carveProfile(strength);
const bands = analyseCarveBands(voice, SAMPLE_RATE, profile);
const duck = analyseCarveDuck(voice, decode(bedTag), SAMPLE_RATE, profile, 0);
let claimed = { version: 1, nodes: [] };
const mint = (node) => {
  const next = { ...node, id: mintAudioFxNodeId(claimed), fromCarve: true };
  claimed = { version: 1, nodes: [...claimed.nodes, next] };
  return next;
};
const bandNodes = bands.map((band) => mint(carveBandsToChain([band]).nodes[0]));
const duckNode = duck.length > 0 ? mint({ type: "gain", enabled: true, params: { ...defaultAudioFxParams("gain"), gain: 0 } }) : null;
const chain = { version: 1, nodes: [...bandNodes, ...(duckNode ? [duckNode] : [])] };
const lane = (id, points) => {
  const timed = points.map((point) => ({ t: Number(point.t.toFixed(3)), v: point.v })).filter((point) => point.t >= 0);
  if ((timed[0]?.t ?? 0) > 0) timed.unshift({ t: 0, v: 0 });
  return timed.length > 1 ? [{ target: `fx.${id}.gain`, points: timed }] : [];
};
const lanes = [
  ...analyseCarveDynamics(voice, SAMPLE_RATE, bands).flatMap((dynamic, index) => lane(bandNodes[index].id, dynamic.points)),
  ...(duckNode ? lane(duckNode.id, duck) : []),
];
const written = ` data-fx-carve="${escape(JSON.stringify({ ...settings, dynamic: true }))}" data-fx-chain="${escape(serializeAudioFxChain(chain))}" data-automation="${escape(JSON.stringify({ version: 1, lanes }))}"`;
let stripped = bedTag;
for (const name of ["data-fx-carve", "data-fx-chain", "data-automation"]) stripped = stripped.replace(new RegExp(`\\s${name}="[^"]*"`, "i"), "");
const nextTag = stripped.replace(/\/?>$/, (close) => `${written}${close}`);
writeFileSync(compPath, sourceHtml.replace(bedTag, nextTag));
process.stdout.write(JSON.stringify({ bedId, voices: voiceTags.length, bands: bands.length, lanes: lanes.length }));
