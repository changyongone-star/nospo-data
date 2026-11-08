// 노스포스포츠 하이라이트 자동 수집기
// 공식 유튜브 채널들의 '긴 영상' 업로드 RSS(API 키 불필요)를 읽어
// 제목에서 리그·대진·세트(차전) 번호만 뽑아 matches.json(결과 정보 없음)을 갱신한다.
// 원본 제목은 저장하지 않는다. 파싱한 영상 정보(videos.json)는 30일이 지나면 지운다.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channelId.slice(2)}`;
const SOURCES = [
  { name: 'LCK', channel: 'UCw1DsweY9b2AKGjV4kGJP1A', parse: parseLol },
  { name: 'TVING SPORTS', channel: 'UC8JtQf77wqhVpOQ8Cze8JjA', parse: parseTving },
  { name: '쿠팡플레이 스포츠', channel: 'UCnBht7BrOx-A328KFXgysqQ', parse: parseCoupang },
  { name: 'NBA', channel: 'UCWJ2lWNubArHWmf3FIHbfcQ', parse: parseNba },
];
const KEEP_VIDEO_DAYS = 30; // 유튜브 데이터 보관 30일 원칙
const KEEP_MATCH_DAYS = 120;
const READY_AFTER_H = 6;

// ---------- 팀 이름 → 앱 팀 id ----------
const LCK = ['gen', 'hle', 't1', 'dk', 'kt', 'bfx', 'ns', 'dnf', 'drx', 'bro'];
const LOL_ALIAS = { tl: 'tlaw', geng: 'gen' };
const KBO = { LG: 'lg', 두산: 'doosan', 키움: 'kiwoom', SSG: 'ssg', KT: 'kt', NC: 'nc', 롯데: 'lotte', 삼성: 'samsung', KIA: 'kia', 한화: 'hanwha' };
const KBL = { SK: 'sk', 삼성: 'samsung', LG: 'lg', KT: 'kt', 현대모비스: 'mobis', 모비스: 'mobis', DB: 'db', 정관장: 'kgc', KCC: 'kcc', 소노: 'sono', 한국가스공사: 'kogas', 가스공사: 'kogas' };
// 사전에 없는 팀은 '리그:이름' 형태로 (앱이 이름 그대로 표시)
const mapTeam = (league, table, name) => {
  const n = name.trim();
  const hit = table[n] ?? table[n.toUpperCase()];
  return hit ? `${league}-${hit}` : `${league}:${n}`;
};

// ---------- 제목 파서: { leagueId, a, b, unit:'game'|'match'|'single', n, stage, event, gameDate? } ----------
export function parseLol(title) {
  const parts = title.split('|').map((s) => s.trim());
  const i = parts.findIndex((p) => /^\S+ vs \S+ (게임 \d|매치) 하이라이트$/.test(p));
  if (i < 0) return null;
  const m = parts[i].match(/^(\S+) vs (\S+) (?:게임 (\d)|매치) 하이라이트$/);
  const id = (c) => {
    const x = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    return LOL_ALIAS[x] ?? x;
  };
  return {
    leagueId: 'lol',
    a: id(m[1]),
    b: id(m[2]),
    unit: m[3] ? 'game' : 'match',
    n: m[3] ? Number(m[3]) : null,
    stage: parts[i + 1] ?? '',
    event: parts[i + 2] ?? '',
  };
}

// [KT vs 삼성] 2026/11/7 한국시리즈 4차전 I 2026 신한 SOL KBO 한국시리즈 I 하이라이트 I TVING
// [정관장 vs SK] 11/6 경기 I 2026-27 KCC 프로농구 I 하이라이트 I TVING
export function parseTving(title) {
  const m = title.match(/^\[([^\]]+?) vs ([^\]]+?)\]\s+(\S+)\s+(.*?)\s*I\s*(.+?)\s*I\s*하이라이트\s*I\s*TVING$/);
  if (!m) return null;
  const [, a, b, dateStr, rest, event] = m;
  const leagueId = /KBO/.test(event) ? 'kbo' : /프로농구|KBL/.test(event) ? 'kbl' : null;
  if (!leagueId) return null;
  const table = leagueId === 'kbo' ? KBO : KBL;
  const series = rest.match(/^(.+?)\s*(\d+)차전$/); // 포스트시즌 시리즈
  return {
    leagueId,
    a: mapTeam(leagueId, table, a),
    b: mapTeam(leagueId, table, b),
    unit: series ? 'game' : 'single',
    n: series ? Number(series[2]) : null,
    stage: series ? series[1].trim() : '',
    event,
    dateStr,
  };
}

// [프리미어리그] 9R 첼시 vs 맨유 2분 하이라이트 / [K리그1] 34R 서울 vs 인천 풀 하이라이트
export function parseCoupang(title) {
  const m = title.match(/^\[(프리미어리그|K리그1)\]\s+(\S+)\s+(.+?) vs (.+?)\s+(풀|\d+분) 하이라이트$/);
  if (!m) return null;
  const leagueId = m[1] === '프리미어리그' ? 'epl' : 'kleague';
  return {
    leagueId,
    a: `${leagueId}:${m[3].trim()}`,
    b: `${leagueId}:${m[4].trim()}`,
    unit: 'single',
    n: null,
    stage: m[2],
    event: m[1],
    quality: m[5] === '풀' ? 2 : 1, // 풀 하이라이트를 우선
  };
}

// ---------- 공통 ----------
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const hashId = (s) => 'm-' + createHash('sha1').update(s).digest('hex').slice(0, 10);

/** 제목 속 날짜(2026/11/7, 11/7)를 YYYY-MM-DD로. 없으면 업로드 날짜 */
// NBA 공식 채널: "[EXTENDED: ]TRAIL BLAZERS at LAKERS | [EMIRATES NBA CUP 🏆 | ]FULL GAME HIGHLIGHTS | November 6, 2026"
// 풀게임 하이라이트만 쓴다 (다른 영상 제목은 기록·결과를 담고 있어서 제외)
const NBA = {
  HAWKS: 'atl', CELTICS: 'bos', NETS: 'bkn', HORNETS: 'cha', BULLS: 'chi', CAVALIERS: 'cle', MAVERICKS: 'dal', NUGGETS: 'den',
  PISTONS: 'det', WARRIORS: 'gsw', ROCKETS: 'hou', PACERS: 'ind', CLIPPERS: 'lac', LAKERS: 'lal', GRIZZLIES: 'mem', HEAT: 'mia',
  BUCKS: 'mil', TIMBERWOLVES: 'min', PELICANS: 'nop', KNICKS: 'nyk', THUNDER: 'okc', MAGIC: 'orl', '76ERS': 'phi', SUNS: 'phx',
  'TRAIL BLAZERS': 'por', KINGS: 'sac', SPURS: 'sas', RAPTORS: 'tor', JAZZ: 'uta', WIZARDS: 'was',
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function parseNba(title) {
  const parts = title.split('|').map((s) => s.trim());
  if (!parts.some((p) => /^FULL GAME HIGHLIGHTS$/i.test(p))) return null;
  const extended = /^EXTENDED:\s*/i.test(parts[0]);
  const m = parts[0].replace(/^EXTENDED:\s*/i, '').match(/^(.+?)\s+(?:at|vs\.?)\s+(.+)$/i);
  if (!m) return null;
  const a = NBA[m[1].trim().toUpperCase()];
  const b = NBA[m[2].trim().toUpperCase()];
  if (!a || !b) return null;
  const d = parts[parts.length - 1].match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  const mon = d ? MONTHS.indexOf(d[1].toLowerCase()) + 1 : 0;
  const cup = parts.some((p) => /NBA CUP/i.test(p));
  return {
    leagueId: 'nba',
    a: `nba-${a}`,
    b: `nba-${b}`,
    unit: 'single',
    n: null,
    stage: cup ? 'NBA컵' : '',
    event: 'NBA',
    dateStr: mon ? `${d[3]}/${mon}/${d[2]}` : undefined,
    quality: extended ? 2 : 1, // 확장판 우선
  };
}

function gameDate(v) {
  const pub = kstDate(v.published);
  const s = v.dateStr ?? '';
  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${pub.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return pub;
}

/**
 * 채널의 최신 영상 목록. 1) 유튜브 RSS (키 불필요)  2) RSS가 막히면 YouTube Data API (YT_API_KEY 필요)
 * 둘 다 공식 제공 방식이며, 제목·영상 ID·게시 시각만 사용한다.
 */
async function fetchChannel(src) {
  const ua = { 'user-agent': 'nospo-sports-updater' };
  const errors = [];
  for (const url of [feedUrl(src.channel), `https://www.youtube.com/feeds/videos.xml?channel_id=${src.channel}`]) {
    try {
      const res = await fetch(url, { headers: ua });
      if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
      return parseFeed(await res.text(), src.parse);
    } catch (e) {
      errors.push(e.message);
    }
  }
  const key = process.env.YT_API_KEY;
  if (!key) throw new Error(errors.join(' / ') + ' (YT_API_KEY 없음)');
  for (const pl of [`UULF${src.channel.slice(2)}`, `UU${src.channel.slice(2)}`]) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${pl}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) {
      errors.push(`API HTTP ${res.status}`);
      continue;
    }
    const out = [];
    for (const it of (await res.json()).items ?? []) {
      const id = it.contentDetails?.videoId;
      const title = it.snippet?.title;
      const published = it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt;
      if (!id || !title || !published) continue;
      const p = src.parse(title);
      if (p) out.push({ id, published, ...p });
    }
    console.log(`[${src.name}] RSS 실패 → API로 ${out.length}개`);
    return out;
  }
  throw new Error(errors.join(' / '));
}

function parseFeed(xml, parse) {
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = e
      .match(/<title>([^<]*)<\/title>/)?.[1]
      ?.replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!id || !title || !published) continue;
    const p = parse(title);
    if (p) out.push({ id, published, ...p });
  }
  return out;
}

const pair = (league, a, b) => {
  const rank = (x) => (league === 'lol' && LCK.includes(x) ? 0 : 1);
  return [a, b].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
};
const leagueLabel = (v) => {
  if (v.leagueId === 'lol') {
    const ev = v.event.includes('월드 챔피언십') ? '월즈' : v.event.replace(/^\d{4}\s*/, '');
    return `${ev} ${v.stage.replace(/\s*Day\s*\d+$/i, '')}`.trim();
  }
  if (v.leagueId === 'kbo') return v.stage ? `KBO ${v.stage}` : 'KBO 리그';
  if (v.leagueId === 'kbl') return 'KBL';
  if (v.leagueId === 'nba') return v.stage ? `NBA · ${v.stage}` : 'NBA';
  if (v.leagueId === 'epl') return `프리미어리그 ${v.stage}`;
  if (v.leagueId === 'kleague') return `K리그1 ${v.stage}`;
  return v.event;
};
const SERIES_LEN = (v) => (v.leagueId === 'kbo' ? (/한국시리즈/.test(v.stage) ? 7 : /와일드카드/.test(v.stage) ? 3 : 5) : 5);

async function readJSON(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const now = Date.now();
  let videos = await readJSON('videos.json', []);
  for (const v of videos) v.leagueId ??= 'lol'; // 예전 형식 호환
  for (const v of videos) if (v.leagueId === 'lol' && v.kind) ((v.unit = v.kind), (v.n = v.game), delete v.kind, delete v.game);

  if (!process.env.OFFLINE) {
    for (const src of SOURCES) {
      try {
        for (const v of await fetchChannel(src)) {
          const i = videos.findIndex((x) => x.id === v.id);
          if (i >= 0) videos[i] = v;
          else videos.push(v);
        }
      } catch (e) {
        console.error(`[${src.name}] 실패:`, e.message); // 한 채널이 실패해도 나머지는 계속
      }
    }
  }
  videos = videos.filter((v) => now - Date.parse(v.published) < KEEP_VIDEO_DAYS * 864e5);

  // 경기(또는 시리즈)별로 묶기
  const groups = new Map();
  for (const v of videos) {
    const [a, b] = pair(v.leagueId, v.a, v.b);
    // LoL은 예전 matchId와 같게 유지 (리그 접두어 없음)
    const prefix = v.leagueId === 'lol' ? '' : `${v.leagueId}|`;
    const key =
      v.unit === 'single'
        ? `${prefix}${gameDate(v)}|${v.stage}|${a}|${b}`
        : `${prefix}${v.event}|${v.stage}|${a}|${b}`;
    if (!groups.has(key)) groups.set(key, { a, b, vids: [] });
    groups.get(key).vids.push(v);
  }

  const matches = await readJSON('matches.json', []);
  for (const [key, g] of groups) {
    const v0 = g.vids[0];
    const games = g.vids.filter((v) => v.unit === 'game');
    const matchVid = g.vids.find((v) => v.unit === 'match');
    const singles = g.vids.filter((v) => v.unit === 'single').sort((x, y) => (y.quality ?? 0) - (x.quality ?? 0));
    const last = Math.max(...g.vids.map((v) => Date.parse(v.published)));
    const firstDate = g.vids.map(gameDate).sort()[0];
    let m;
    if (games.length) {
      const len = SERIES_LEN(v0);
      m = {
        bestOf: len,
        // LoL: 매치 하이라이트가 올라오면 경기 종료 / 야구 시리즈: 각 차전 영상이 곧 완결
        ready: v0.leagueId !== 'lol' || !!matchVid || now - last > READY_AFTER_H * 3600e3,
        sets: Array.from({ length: len }, (_, i) => ({ setNo: i + 1, videoId: games.find((v) => v.n === i + 1)?.id ?? null })),
      };
    } else {
      const vid = matchVid ?? singles[0];
      if (!vid) continue;
      m = { bestOf: 1, ready: true, sets: [{ setNo: 1, videoId: vid.id }] };
    }
    m = {
      matchId: hashId(key),
      leagueId: v0.leagueId,
      date: firstDate,
      league: leagueLabel(v0),
      teamA: g.a,
      teamB: g.b,
      ...m,
    };
    const i = matches.findIndex((x) => x.matchId === m.matchId);
    if (i >= 0) matches[i] = m;
    else matches.push(m);
  }

  for (const m of matches) m.leagueId ??= 'lol';
  const kept = matches
    .filter((m) => now - Date.parse(m.date) < KEEP_MATCH_DAYS * 864e5)
    .sort((x, y) => y.date.localeCompare(x.date));
  await writeFile('matches.json', JSON.stringify(kept, null, 1) + '\n');
  await writeFile('videos.json', JSON.stringify(videos, null, 1) + '\n');
  const by = kept.reduce((acc, m) => ((acc[m.leagueId] = (acc[m.leagueId] ?? 0) + 1), acc), {});
  console.log(`videos ${videos.length}, matches ${kept.length}`, by);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
