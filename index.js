require("dotenv").config();
const axios = require("axios");
const fs = require("fs");

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  PLAYLIST_ID,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  SPOTIFY_REFRESH_TOKEN,
} = process.env;

const STATE_FILE = "state.json";

const USER_NAME_MAP = {
  "1131604223": "Mark",
  "1180676527": "Ralle",
  "1129098837": "Zelda",
  "11142368883": "Eric",
  "317fs6s37yjgxd75wnv665enupsy": "Sarah",
  "31cblyq4jtttrnfatc47o326glky": "Joshua",
  "31orh3wjg725krazo5ee5okm2s64": "Hugo",
  "31sbs7b4z22qnyld4t44jcrroi34": "Moritz",
  "agi7ator": "Gröer",
  "hanni229": "Hannah",
  "maximilian.kardinal": "Max",
  "tobsn_s": "Tobi",
  "katja.becker98": "Katja",
  "soeren.hellstern": "Sören",
  "1149851307": "Emily",
  "mc68u1hjk832a59fdjcbkj8qp": "Alex",
  "wc4ojpn802i3epoyfav9i904f": "Sabrina"
};

function name(id) {
  return USER_NAME_MAP[id] || id;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { processedDays: {}, totalPenalties: {}, knownUsers: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function berlinDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return `${parts.find(p => p.type === "year").value}-${parts.find(p => p.type === "month").value}-${parts.find(p => p.type === "day").value}`;
}

async function getToken() {
  const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return res.data.access_token;
}

async function getSongs(token) {
  let url = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items?limit=100&market=DE`;
  const rows = [];

  while (url) {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    for (const e of res.data.items || []) {
      const t = e.item;
      if (!t || t.type !== "track") continue;

      rows.push({
        date: new Date(e.added_at),
        user: e.added_by?.id || "unknown",
        track: t.name,
        artist: t.artists.map(a => a.name).join(", "),
      });
    }

    url = res.data.next;
  }

  return rows;
}

function prepare(rows) {
  return rows.map(r => ({
    ...r,
    day: berlinDate(r.date)
  }));
}

function addPenalty(state, user) {
  if (!state.totalPenalties[user]) state.totalPenalties[user] = 0;
  state.totalPenalties[user]++;
}

function processDay(state, day, rows) {
  const usersToday = new Set(rows.map(r => r.user));
  const missing = state.knownUsers.filter(u => !usersToday.has(u));

  const map = {};
  for (const r of rows) {
    const key = `${r.track} - ${r.artist}`.toLowerCase().trim();
    if (!map[key]) map[key] = [];
    map[key].push(r.user);
  }

  const dupes = Object.entries(map).filter(([, users]) => users.length > 1);

  for (const u of missing) addPenalty(state, u);

  for (const [, users] of dupes) {
    for (const u of [...new Set(users)]) addPenalty(state, u);
  }

  state.processedDays[day] = {
    missingUsers: missing,
    duplicateSongs: dupes.map(([song, users]) => ({
      song,
      users: [...new Set(users)]
    })),
    processedAt: new Date().toISOString()
  };
}

function updateState(rows) {
  const state = loadState();
  const today = berlinDate();
  const data = prepare(rows);

  const allUsers = [...new Set(data.map(r => r.user))];
  state.knownUsers = [...new Set([...(state.knownUsers || []), ...allUsers])];

  const completedDays = [...new Set(data.map(r => r.day))]
    .filter(day => day < today)
    .sort();

  let lastProcessedDay = null;

  for (const day of completedDays) {
    if (state.processedDays[day]) continue;

    const rowsForDay = data.filter(r => r.day === day);
    processDay(state, day, rowsForDay);
    lastProcessedDay = day;
  }

  saveState(state);
  return { state, lastProcessedDay };
}

function buildReport(state, lastProcessedDay) {
  if (!lastProcessedDay) {
    return "Hier kommt euer Daily Report 🍻\n\nKein neuer abgeschlossener Tag zum Auswerten.";
  }

  const dayData = state.processedDays[lastProcessedDay];

  let msg = `Hier kommt euer Daily Report 🍻\n`;
  msg += `Tag: ${lastProcessedDay}\n\n`;

  msg += "Doppelte Songs:\n";
  msg += dayData.duplicateSongs.length
    ? dayData.duplicateSongs.map(d => `→ ${d.song} (${d.users.map(name).join(", ")})`).join("\n")
    : "→ Keine";

  msg += "\n\nSongs vergessen:\n";
  msg += dayData.missingUsers.length
    ? dayData.missingUsers.map(u => `→ ${name(u)}`).join("\n")
    : "→ Keine";

  msg += "\n\nGesamtstrafen:\n";
  msg += Object.entries(state.totalPenalties)
    .sort((a, b) => b[1] - a[1])
    .map(([user, points]) => `→ ${name(user)}: ${points}`)
    .join("\n");

  return msg;
}

async function send(msg) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text: msg,
  });
}

(async () => {
  try {
    const token = await getToken();
    const rows = await getSongs(token);

    const { state, lastProcessedDay } = updateState(rows);
    const report = buildReport(state, lastProcessedDay);

    console.log(report);
    await send(report);
  } catch (e) {
    console.log("FEHLER:");
    console.log(e.response?.status);
    console.log(e.response?.data || e.message);
  }
})();
