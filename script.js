
const fs = require("fs");
const file = "C:/repos/club-app-backend/src/services/clubService.ts";
let text = fs.readFileSync(file, "utf8");
const lines = text.split("\n");
const idx = lines.findIndex(l => l.includes("if (updates.clubLogoUrl !== undefined) {"));

if (idx >= 0) {
  lines[idx] = "      if (updates.clubLogoUrl !== undefined) {";
  lines[idx+1] = "        const keepId = extractCloudinaryPublicId(updates.clubLogoUrl);";
  lines[idx+2] = "        const folder = `passeo/clubs/${clubId}/logos`;";
  lines[idx+3] = "        cleanupCloudinaryFolder(folder, keepId ? [keepId] : []).catch((e) => logger.warn(`Cleanup failed for ${folder}:`, e));";
  lines[idx+4] = "      }";
}

fs.writeFileSync(file, lines.join("\n"));
console.log("done, idx:", idx);

