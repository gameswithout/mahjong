// Prepare provider configuration from an exported, working session template.
// Does not authenticate, mutate the provider, or change client configuration.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [sourcePath, outputPath = ".artifacts/casual-matchmaking"] = process.argv.slice(2);
if (!sourcePath) throw new Error("Usage: node scripts/prepare-casual-matchmaking.mjs <exported-session-template.json> [output-directory]");
const raw = JSON.parse(await readFile(sourcePath, "utf8"));
const source = raw.data && !Array.isArray(raw.data) ? raw.data : raw;
if (!source.name || !source.clientVersion || source.maxPlayers !== 4) throw new Error("Export a working four-seat Mahjong session template, including clientVersion.");
const template = { ...source };
for (const key of ["namespace", "createdAt", "updatedAt", "created_at", "updated_at", "version"]) delete template[key];
template.name = "mahjong-casual";
template.attributes = { game_mode: "unranked", full_rotation: true, ai_practice: true };
template.minPlayers = 1;
template.maxPlayers = 4;
// Preserve the working autoJoin policy. The client already joins the service
// session, and auto-backfill is disabled in the dedicated ruleset.
const output = resolve(outputPath); await mkdir(output, { recursive: true });
await writeFile(resolve(output, "casual-template.json"), JSON.stringify(template, null, 2) + "\n");
for (const file of ["casual-rules.json", "casual-pool.json"]) await writeFile(resolve(output, file), await readFile(new URL(`../docs/matchmaking/${file}`, import.meta.url)));
console.log(`Prepared Casual template, ruleset and pool in ${output}. Review and create them in the provider portal; nothing was deployed.`);
