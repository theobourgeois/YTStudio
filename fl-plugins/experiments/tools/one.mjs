import { stems, writeVariant } from "./plan.mjs";
const [file, which, out, mfx, vol] = process.argv.slice(2);
const s = stems(file);
const keep = which === "all" ? new Set(s.playable.map(c => c.idx)) : new Set(s.list.find(x => x.name === which).chans.map(c => c.idx));
writeVariant(s.flp, s.ins, s.playable, keep, out, { masterFx: mfx === "1", masterVol: vol ? +vol : 12800 });
console.log("wrote", out, "keeping", keep.size);
