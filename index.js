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

steam
  .getUserOwnedGames(STEAM_PROFILE_ID)
  .then((games) => {
    const stream = getOutputStream();
    games
      .filter((game) => !shouldSkip(game.appID, game.name))
      .sort((a, b) => a.appID - b.appID)
      .forEach((game) => {
        stream.write(
          `// ${game.name} - https://store.steampowered.com/app/${game.appID}\n`
        );
        stream.write(`app_update ${game.appID}${validateFlag}\n`);
      });
    stream.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// === Fetch shared games from family lenders using xPaw API ===

const FAMILY_API_KEY = process.env.STEAMAPI_IO_KEY;
const LENDER_IDS = (process.env.STEAM_FAMILY_LIBRARY_ACCOUNT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (FAMILY_API_KEY && LENDER_IDS.length > 0) {
  const stream = getOutputStream();
  const collectedApps = new Map();

  const fetchSharedApps = (lenderId) =>
    new Promise((resolve, reject) => {
      const url = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?key=${STEAM_API_KEY}&steamid=${STEAM_PROFILE_ID}`;
      const options = {
        headers: {
          Authorization: `Key ${FAMILY_API_KEY}`,
        },
      };

      https
        .get(url, options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              if (json?.response?.shared_apps) {
                for (const app of json.response.shared_apps) {
                  collectedApps.set(app.appid, app);
                }
              }
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });

  Promise.all(LENDER_IDS.map(fetchSharedApps))
    .then(() => {
      const sortedApps = [...collectedApps.values()].sort(
        (a, b) => a.appid - b.appid
      );

      sortedApps.forEach((app) => {
        if (!shouldSkip(app.appid, app.name)) {
          stream.write(
            `// [SHARED] https://store.steampowered.com/app/${app.appid}\n`
          );
          stream.write(`app_update ${app.appid}${validateFlag}\n`);
        }
      });
      stream.end();
    })
    .catch((err) => {
      console.error("Error fetching shared apps:", err);
    });
}
