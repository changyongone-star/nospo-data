// 노스포스포츠 하이라이트 자동 수집기
// LCK 공식 유튜브 채널의 '긴 영상' 업로드 RSS(API 키 불필요)를 읽어
// 제목에서 대진·세트 번호만 뽑아 matches.json(결과 정보 없음)을 갱신한다.
// 원본 제목은 저장하지 않는다. 파싱한 영상 정보(videos.json)는 30일이 지나면 지운다.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const FEEDS = [
  // UULF = 채널의 긴 영상(쇼츠 제외) 업로드 목록
  'https://www.youtube.com/feeds/videos.xml?playlist_id=UULFw1DsweY9b2AKGjV4kGJP1A',
];
const LCK = ['gen', 'hle', 't1', 'dk', 'kt', 'bfx', 'ns', 'dnf', 'drx', 'bro'];
const CODE_ALIAS = { tl: 'tlaw', geng: 'gen' };
const KEEP_VIDEO_DAYS = 30; // 유튜브 데이터 보관 30일 원칙
const KEEP_MATCH_DAYS = 90;
const READY_AFTER_H = 6; // 매치 하이라이트가 없어도 마지막 업로드 후 6시간 지나면 공개

const teamId = (code) => {
  const c = code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return CODE_ALIAS[c] ?? c;
};
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const hashId = (s) => 'm-' + createHash('sha1').update(s).digest('hex').slice(0, 10);

/** 제목 → { a, b, kind:'game'|'match', game, stage, event } (하이라이트가 아니면 null) */
export function parseTitle(title) {
  const parts = title.split('|').map((s) => s.trim());
  const i = parts.findIndex((p) => /^\S+ vs \S+ (게임 \d|매치) 하이라이트$/.test(p));
  if (i < 0) return null;
  const m = parts[i].match(/^(\S+) vs (\S+) (?:게임 (\d)|매치) 하이라이트$/);
  return {
    a: teamId(m[1]),
    b: teamId(m[2]),
    kind: m[3] ? 'game' : 'match',
    game: m[3] ? Number(m[3]) : null,
    stage: parts[i + 1] ?? '',
    event: parts[i + 2] ?? '',
  };
}

function parseFeed(xml) {
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = e.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!id || !title || !published) continue;
    const p = parseTitle(title);
    if (p) out.push({ id, published, ...p });
  }
  return out;
}

const pair = (a, b) => {
  const rank = (x) => (LCK.includes(x) ? 0 : 1);
  return [a, b].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
};
const leagueLabel = (event, stage) => {
  const ev = event.includes('월드 챔피언십') ? '월즈' : event.replace(/^\d{4}\s*/, '');
  return `${ev} ${stage.replace(/\s*Day\s*\d+$/i, '')}`.trim();
};

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
  if (!process.env.OFFLINE) {
    for (const url of FEEDS) {
      const res = await fetch(url, { headers: { 'user-agent': 'nospo-sports-updater' } });
      if (!res.ok) throw new Error(`feed ${res.status}`);
      for (const v of parseFeed(await res.text())) {
        const i = videos.findIndex((x) => x.id === v.id);
        if (i >= 0) videos[i] = v;
        else videos.push(v);
      }
    }
  }
  videos = videos.filter((v) => now - Date.parse(v.published) < KEEP_VIDEO_DAYS * 864e5);

  // 경기별로 묶기
  const groups = new Map();
  for (const v of videos) {
    const [a, b] = pair(v.a, v.b);
    const key = `${v.event}|${v.stage}|${a}|${b}`;
    if (!groups.has(key)) groups.set(key, { a, b, stage: v.stage, event: v.event, vids: [] });
    groups.get(key).vids.push(v);
  }

  const matches = await readJSON('matches.json', []);
  for (const [key, g] of groups) {
    const games = g.vids.filter((v) => v.kind === 'game');
    const matchVid = g.vids.find((v) => v.kind === 'match');
    const first = g.vids.map((v) => v.published).sort()[0];
    const last = g.vids.map((v) => Date.parse(v.published)).sort((x, y) => y - x)[0];
    const series = games.length > 0;
    const m = {
      matchId: hashId(key),
      date: kstDate(first),
      league: leagueLabel(g.event, g.stage),
      teamA: g.a,
      teamB: g.b,
      bestOf: series ? 5 : 1,
      // 매치 하이라이트가 올라왔다 = 경기 종료. 아니면 마지막 업로드 후 일정 시간 대기
      ready: !!matchVid || now - last > READY_AFTER_H * 3600e3,
      sets: series
        ? [1, 2, 3, 4, 5].map((n) => ({ setNo: n, videoId: games.find((v) => v.game === n)?.id ?? null }))
        : [{ setNo: 1, videoId: matchVid?.id ?? null }],
    };
    if (!series && !matchVid) continue;
    const i = matches.findIndex((x) => x.matchId === m.matchId);
    if (i >= 0) matches[i] = m;
    else matches.push(m);
  }

  const kept = matches
    .filter((m) => now - Date.parse(m.date) < KEEP_MATCH_DAYS * 864e5)
    .sort((x, y) => y.date.localeCompare(x.date));
  await writeFile('matches.json', JSON.stringify(kept, null, 1) + '\n');
  await writeFile('videos.json', JSON.stringify(videos, null, 1) + '\n');
  console.log(`videos ${videos.length}, matches ${kept.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
