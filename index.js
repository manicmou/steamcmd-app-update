#!/usr/bin/env node
const fs = require("fs");
const https = require("https");

const STEAM_API_KEY = process.env.STEAM_API_KEY;

if (!STEAM_API_KEY) {
  console.error(
    "The STEAM_API_KEY environment variable should contain your Steam API key."
  );
  console.error("See: https://steamcommunity.com/dev/apikey");
  process.exit(1);
}

const steam = new (require("steamapi"))(STEAM_API_KEY);

const STEAM_PROFILE_ID = process.env.STEAM_PROFILE_ID;

if (!STEAM_PROFILE_ID) {
  console.error("The STEAM_PROFILE_ID environment variable is required.");
  process.exit(1);
}

const skipGames = [];

if (process.env.SKIP_GAMES) {
  process.env.SKIP_GAMES.split(",")
    .map((game) => game.trim())
    .forEach((game) => {
      skipGames.push(game);
    });
}

function shouldSkip(gameId, gameTitle) {
  return (
    // We could be comparing strings against numbers here, that's fine
    skipGames.find((game) => game == gameId || game == gameTitle) !== undefined
  );
}

function getOutputStream() {
  return !!process.env.OUTPUT_FILE
    ? fs.createWriteStream(process.env.OUTPUT_FILE)
    : process.stdout;
}

const validateFlag = !!process.env.FORCE_VALIDATE ? " -validate" : "";

// Shared stream + completion counter
const stream = getOutputStream();
let completedSections = 0;

function markDone() {
  completedSections++;
  if (completedSections === 2) {
    if (stream !== process.stdout) {
      stream.end();
    }
  }
}

// === Fetch owned games ===
steam
  .getUserOwnedGames(STEAM_PROFILE_ID)
  .then((games) => {
    games
      .filter((game) => !shouldSkip(game.appID, game.name))
      .sort((a, b) => a.appID - b.appID)
      .forEach((game) => {
        stream.write(
          `// ${game.name} - https://store.steampowered.com/app/${game.appID}\n`
        );
        stream.write(`app_update ${game.appID}${validateFlag}\n`);
      });
    markDone();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// === Fetch shared games from family lenders using xPaw API ===
const STEAM_API_TOKEN = process.env.STEAM_API_TOKEN;
const STEAM_FAMILY_ID = process.env.STEAM_FAMILY_ID;

if (!STEAM_API_TOKEN || !STEAM_FAMILY_ID) {
  if (!STEAM_API_TOKEN)
    console.error("The STEAM_API_TOKEN environment variable is required for updating shared library apps.");
  if (!STEAM_FAMILY_ID)
    console.error("The STEAM_FAMILY_ID environment variable is required for updating shared library apps.");
  markDone(); // Still mark as done even if skipping this section
} else {
  const sharedGamesUrl = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token=${STEAM_API_TOKEN}&family_groupid=${STEAM_FAMILY_ID}&steamid=${STEAM_PROFILE_ID}`;
  fetch(sharedGamesUrl, {
    headers: {
      Authorization: `Key ${STEAM_API_KEY}`,
    },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const apps = data?.response?.apps || [];
      apps
        .filter((app) => !shouldSkip(app.appid, app.name))
        .sort((a, b) => a.appid - b.appid)
        .forEach((app) => {
          stream.write(
            `// ${app.name} - https://store.steampowered.com/app/${app.appid}\n`
          );
          stream.write(`app_update ${app.appid}${validateFlag}\n`);
        });
      markDone();
    })
    .catch((err) => {
      console.error("Failed to fetch shared games:", err);
      markDone();
    });
}
