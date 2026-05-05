require("dotenv").config();
const axios = require("axios");

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  PLAYLIST_ID,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  SPOTIFY_REFRESH_TOKEN,
} = process.env;

// ===== NAMEN =====
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

// ===== BERLIN DATUM =====
function berlinDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return `${parts.find(p=>p.type==="year").value}-${parts.find(p=>p.type==="month").value}-${parts.find(p=>p.type==="day").value}`;
}

// ===== TOKEN =====
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

// ===== SONGS LADEN =====
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
        user: e.added_by?.id,
        track: t.name,
        artist: t.artists.map(a => a.name).join(", "),
      });
    }

    url = res.data.next;
  }

  return rows;
}

// ===== REPORT =====
function build(rows) {
  if (!rows.length) return "Keine Songs 🍻";

  const today = berlinDate();

  const enriched = rows.map(r => {
    const d = new Date(r.date);
    d.setHours(d.getHours() + 2);
    return { ...r, day: d.toISOString().slice(0,10) };
  });

  // nur abgeschlossene Tage
  const past = enriched.filter(r => r.day < today);

  if (!past.length) return "Noch kein abgeschlossener Tag 🍻";

  const days = [...new Set(past.map(r => r.day))].sort();
  const lastDay = days.at(-1);

  const dayRows = past.filter(r => r.day === lastDay);

  const allUsers = [...new Set(enriched.map(r => r.user))];

  const usersToday = new Set(dayRows.map(r => r.user));
  const missing = allUsers.filter(u => !usersToday.has(u));

  // duplicates
  const map = {};
  for (const r of dayRows) {
    const key = (r.track + r.artist).toLowerCase();
    if (!map[key]) map[key] = [];
    map[key].push(r.user);
  }

  const dupes = Object.entries(map).filter(([,u]) => u.length > 1);

  let msg = `Hier kommt euer Daily Report 🍻\n`;
  msg += `Tag: ${lastDay}\n\n`;

  msg += "Doppelte Songs:\n";
  msg += dupes.length
    ? dupes.map(([s,u]) => `→ ${s} (${[...new Set(u)].map(name).join(", ")})`).join("\n")
    : "→ Keine";

  msg += "\n\nSongs vergessen:\n";
  msg += missing.length
    ? missing.map(u => `→ ${name(u)}`).join("\n")
    : "→ Keine";

  return msg;
}

// ===== TELEGRAM =====
async function send(msg) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text: msg,
  });
}

// ===== MAIN =====
(async () => {
  try {
    const token = await getToken();
    const rows = await getSongs(token);
    const report = build(rows);

    console.log(report);
    await send(report);
  } catch (e) {
    console.log("FEHLER:");
    console.log(e.response?.status);
    console.log(e.response?.data || e.message);
  }
})();
