// @/lib/icarus-extractor.ts
import { fetchWithTimeout } from "./fetch-timeout.ts";
import { createClient } from "@supabase/supabase-js";
import { encryptUrl } from "./encryptor.ts";

const supabase = createClient(
  process.env.SUPABASE_URL_MOVIEBOX_WEB!,
  process.env.SUPABASE_SERVICE_ROLE_KEY_MOVIEBOX_WEB!,
);

let blacklistCache: Set<string> | null = null;
let blacklistCacheTime = 0;
const BLACKLIST_TTL = 5 * 60_000;

async function getNext8AMPH(): Promise<string> {
  const now = new Date();
  const ph = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const next8AM = new Date(ph);
  next8AM.setHours(8, 0, 0, 0);
  if (ph >= next8AM) next8AM.setDate(next8AM.getDate() + 1);
  const diff = next8AM.getTime() - ph.getTime();
  return new Date(now.getTime() + diff).toISOString();
}

async function blacklistProxy(proxy: string) {
  const expires_at = await getNext8AMPH();
  await supabase
    .from("proxy_blacklist")
    .upsert(
      { proxy, expires_at, hit_count: 1 },
      { onConflict: "proxy", ignoreDuplicates: false },
    );
  blacklistCache?.add(proxy);
  console.log(`[PROXY] ⛔ blacklisted ${proxy}`);
}

async function getActiveProxies(proxies: string[]): Promise<string[]> {
  if (!blacklistCache || Date.now() - blacklistCacheTime > BLACKLIST_TTL) {
    const { data } = await supabase
      .from("proxy_blacklist")
      .select("proxy")
      .gt("expires_at", new Date().toISOString());
    blacklistCache = new Set((data ?? []).map((r: any) => r.proxy));
    blacklistCacheTime = Date.now();
  }
  return proxies.filter((p) => !blacklistCache!.has(p));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getRandomAfricanIP() {
  const ranges: [number, number][] = [
    [41, 57],
    [41, 60],
    [41, 72],
    [41, 73],
    [41, 116],
    [41, 138],
    [41, 160],
    [41, 175],
    [41, 188],
    [41, 203],
    [41, 215],
    [41, 222],
    [102, 0],
    [102, 22],
    [102, 68],
    [102, 89],
    [102, 130],
    [102, 164],
    [102, 176],
    [102, 212],
    [105, 16],
    [105, 48],
    [105, 112],
    [105, 160],
    [105, 224],
    [197, 136],
    [197, 148],
    [197, 156],
    [197, 210],
    [197, 232],
    [197, 248],
    [45, 96],
    [45, 100],
    [45, 108],
  ];
  const base = ranges[Math.floor(Math.random() * ranges.length)];
  const rand = () => Math.floor(Math.random() * 254) + 1;
  return `${base[0]}.${base[1]}.${rand()}.${rand()}`;
}
export const proxies = [
  "https://snowy-lab-9d5f.icarus033.workers.dev/",
  "https://rough-pond-0449.icarus032.workers.dev/",
  "https://weathered-mountain-aca0.icarus031.workers.dev/",
  "https://fragrant-surf-698c.icarus030.workers.dev/",
  //
  // "https://yellow-truth-b7cf.icarus057.workers.dev/",
  // "https://fragrant-wind-40f0.icarus059.workers.dev/",
  // "https://icy-frost-2f13.icarus053.workers.dev/",
  // "https://long-meadow-047f.vps9-9ce.workers.dev/",
  // "https://damp-rain-dad6.icarus048.workers.dev/",
  // "https://old-smoke-c852.icarus043.workers.dev/",
  // "https://late-meadow-f5cf.icarus042.workers.dev/",
  // "https://autumn-sky-7829.icarus041.workers.dev/",
  // "https://super-tree-8f2e.icarus040.workers.dev/",
  // "https://steep-sky-b7c6.icarus039.workers.dev/",
  // "https://patient-base-d281.icarus038.workers.dev/",
  // "https://small-bonus-631a.icarus044.workers.dev/",
  // "https://tight-fog-810b.icarus046.workers.dev/",
  // "https://sweet-frost-4413.icarus037.workers.dev/",
  // "https://wild-frost-90b0.icarus035.workers.dev/",
  // "https://frosty-term-80f0.icarus036.workers.dev/",
  // "https://misty-wildflower-f895.icarus034.workers.dev/",
];
async function getWorkingProxy(proxies: string[]) {
  const activeProxies = await getActiveProxies(proxies);
  const shuffledProxies = shuffle(activeProxies);
  if (!shuffledProxies.length) return null;

  for (const proxy of shuffledProxies) {
    try {
      const res = await fetchWithTimeout(proxy, { method: "HEAD" }, 3000);
      if (res.status === 429) {
        await blacklistProxy(proxy);
        continue;
      }
      if (res.status === 403) continue;
      if (res.ok) return proxy;
    } catch {
      // network error / timeout → try next
    }
  }
  return null;
}

// ==================== TYPES ====================
export type IcarusExtractInput = {
  tmdbId: string;
  mediaType: string;
  title: string;
  date: string;
  season?: string | null;
  episode?: string | null;
  dubCode?: string | null;
  dubType?: string | null;
};

export type IcarusExtractResult =
  | {
      success: true;
      links: Array<{
        resolution: any;
        format: any;
        size: any;
        type: "hls" | "mp4";
        link: string;
      }>;
      subtitles: any[];
      dubs: Array<{
        lang: string;
        type: number;
        name: string;
        original: boolean;
      }>;
      meow: boolean;
      meowmeow: boolean;
      active: {
        langCode: string;
        langType: number;
        langName: string;
      };
      top: boolean;
      fallback: boolean;
    }
  | {
      success: false;
      error: string;
      status: number;
    };

// ==================== MAIN ====================
export async function extractIcarus(
  input: IcarusExtractInput,
): Promise<IcarusExtractResult> {
  const { tmdbId, mediaType, title, date, season, episode, dubCode, dubType } =
    input;

  const randomIP = getRandomAfricanIP();
  const baseUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff`;
  const headers = {
    "X-Client-Info": '{"timezone":"Africa/Nairobi"}',
    "Accept-Language": "en-US,en;q=0.5",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "X-Forwarded-For": randomIP,
    "CF-Connecting-IP": randomIP,
    "X-Real-IP": randomIP,
  };

  // -------- Cache Lookup (dubs) --------
  let dubs: any[];
  let cached = false;

  const { data: cachedDubs } = await supabase
    .from("moviebox_cache")
    .select("dubs")
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .maybeSingle();

  if (cachedDubs) {
    dubs = cachedDubs.dubs ?? [];
    cached = true;
  } else {
    const searchRes = await fetchWithTimeout(
      `${baseUrl}/subject/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Referer: "https://h5.aoneroom.com/",
          Origin: "https://h5.aoneroom.com",
        },
        body: JSON.stringify({
          keyword: `${title}`,
          page: 1,
          perPage: 24,
          subjectType: mediaType === "tv" ? 2 : 1,
        }),
      },
      8000,
    );

    const searchJson = await searchRes.json();
    const results = searchJson?.data?.data || searchJson?.data || searchJson;
    const items = results?.items || [];

    if (!items.length) {
      return { success: false, error: "No search results", status: 404 };
    }

    const normalizedTitle = title?.toLowerCase().trim().replace(/-/g, " ");
    const LANG_TAGS =
      /\[(tagalog|hindi|dubbed|multi|spanish|french|arabic|korean|japanese|tamil|telugu)\]/i;
    const queryWords = normalizedTitle!.split(/\s+/).filter(Boolean);
    const dateObj = date ? new Date(date) : null;

    const matchesItem = (item: any, skipLangTags: boolean) => {
      const itemTitle = item.title?.toLowerCase().replace(/-/g, " ") || "";
      const itemReleaseDate = item.releaseDate;
      if (skipLangTags && LANG_TAGS.test(itemTitle)) return false;
      if (!dateObj || !itemReleaseDate) return false;
      const itemDate = new Date(itemReleaseDate);
      const diff =
        itemDate.getFullYear() * 12 +
        itemDate.getMonth() -
        (dateObj.getFullYear() * 12 + dateObj.getMonth());
      if (Math.abs(diff) > 1) return false;
      const itemTitleClean = itemTitle.replace(/\bs\d+(-s\d+)?\b/gi, "").trim();
      const itemWordsClean = itemTitleClean.split(/\s+/).filter(Boolean);
      if (queryWords.length <= 2 && itemWordsClean.length !== queryWords.length)
        return false;
      return queryWords.every((word) => itemTitle.includes(word));
    };

    let selectedItem =
      items.find((item: any) => matchesItem(item, true)) ??
      items.find((item: any) => matchesItem(item, false));

    if (!selectedItem) {
      return { success: false, error: "Unavailable", status: 404 };
    }

    const rawSubjectId = selectedItem?.subjectId;
    if (!rawSubjectId) {
      return { success: false, error: "SubjectId Not Found", status: 404 };
    }

    const detailRes = await fetchWithTimeout(
      `${baseUrl}/detail?detailPath=${selectedItem.detailPath}`,
      {
        headers: {
          ...headers,
          Referer: `https://fmoviesunblocked.net/spa/videoPlayPage/movies/${selectedItem.detailPath}?id=${rawSubjectId}&type=/movie/detail`,
          Origin: "https://fmoviesunblocked.net",
        },
      },
      8000,
    );
    const detailJson = await detailRes.json();
    const info = detailJson?.data?.data || detailJson?.data || detailJson;

    dubs = info?.subject?.dubs || [];

    if (dubs.length === 0) {
      dubs = [
        {
          subjectId: rawSubjectId,
          detailPath: selectedItem.detailPath,
          original: true,
          lanCode: "orig",
          lanName: "Original Audio",
          type: 0,
          constructed: true,
        },
      ];
    }

    if (dubs.length > 0) {
      await supabase.from("moviebox_cache").upsert(
        {
          tmdb_id: tmdbId,
          media_type: mediaType,
          dubs,
          release_date: date,
          title,
        },
        { onConflict: "tmdb_id,media_type", ignoreDuplicates: true },
      );
    }
  }

  // -------- Resolve active subjectId/detailPath from dubs --------
  const original =
    dubs.find((d: any) => d.original === true) ??
    dubs.find((d: any) => d.lanCode === "en") ??
    dubs[0];

  if (!original) {
    return { success: false, error: "No original entry in dubs", status: 404 };
  }

  let subjectId: string = original.subjectId;
  let detailPath: string = original.detailPath;
  let activeDubType: number = original.type ?? 0;
  let activeDubLang: string = original.lanCode ?? "orig";

  if (dubCode) {
    const dubEntry = dubs.find(
      (d: any) => d.lanCode === dubCode && d.type === Number(dubType ?? "0"),
    );
    if (dubEntry) {
      subjectId = dubEntry.subjectId;
      detailPath = dubEntry.detailPath;
      activeDubType = dubEntry.type ?? 0;
      activeDubLang = dubEntry.lanCode;
    }
  }

  // -------- Cache Lookup (downloads) --------
  let sortedDownloads: any[];
  let subtitles: any[] = [];
  let cachedDownloads = false;

  const dlQuery = supabase
    .from("moviebox_downloads_cache")
    .select("downloads")
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .eq("dub", activeDubLang)
    .eq("type", activeDubType)
    .gt("expires_at", new Date().toISOString());

  if (season) dlQuery.eq("season", season);
  else dlQuery.eq("season", "");

  if (episode) dlQuery.eq("episode", episode);
  else dlQuery.eq("episode", "");

  const { data: cachedDl } = await dlQuery.maybeSingle();
  if (cachedDl) {
    sortedDownloads = cachedDl.downloads ?? [];
    cachedDownloads = true;
  } else {
    const playUrl = `https://movibox.net/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${mediaType === "tv" ? season : "0"}&ep=${mediaType === "tv" ? episode : "0"}&detailPath=${detailPath}&streamSignType=1`;
    const playHeaders = {
      ...headers,
      Referer: `https://movibox.net/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`,
      Origin: "https://movibox.net",
    };

    const sourcesRes = await fetchWithTimeout(
      playUrl,
      { headers: playHeaders },
      8000,
    );

    const sourcesJson = await sourcesRes.json();
    const stream = sourcesJson.data.streams || [];

    if (!stream.length) {
      if (!dubCode) {
        return { success: false, error: "No download sources", status: 404 };
      }

      subjectId = dubs[0].subjectId;
      detailPath = dubs[0].detailPath;
      activeDubLang = dubs[0].lanCode ?? "orig";
      activeDubType = dubs[0].type ?? 0;

      const retryRes = await fetchWithTimeout(
        playUrl,
        {
          headers: {
            ...headers,
            Referer: `https://movibox.net/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`,
            Origin: "https://movibox.net",
          },
        },
        8000,
      );

      const retryJson = await retryRes.json();
      const retrySources = retryJson.data.streams || [];
      stream.push(...(retrySources || []));
      subtitles = (retrySources?.captions || []).map((c: any) => ({
        id: c.lan,
        display: c.lanName,
        file: c.url,
      }));

      if (!stream.length) {
        return { success: false, error: "No download sources", status: 404 };
      }
    }

    sortedDownloads = stream
      .filter((d: any) => d?.url && typeof d.url === "string")
      .sort((a: any, b: any) => (b.resolutions || 0) - (a.resolutions || 0));

    if (!sortedDownloads.length) {
      return { success: false, error: "No valid download URLs", status: 404 };
    }
  }

  const workingProxy = await getWorkingProxy(proxies);
  if (!workingProxy) {
    return {
      success: false,
      error: "No working proxy available",
      status: 502,
    };
  }

  if (!cachedDownloads) {
    await supabase.from("moviebox_downloads_cache").upsert(
      {
        tmdb_id: tmdbId,
        media_type: mediaType,
        season: season ?? "",
        episode: episode ?? "",
        dub: activeDubLang,
        type: activeDubType,
        downloads: sortedDownloads,
        play_count: 0,
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 35).toISOString(),
        refreshed_at: new Date().toISOString(),
      },
      {
        onConflict: "tmdb_id,media_type,season,episode,dub,type",
      },
    );
  }

  // sortedDownloads = sortedDownloads.filter(
  //   (d: any) =>
  //     d?.url && !d.url.includes("bcdnxw.") && !d.url.includes("bcdnxw/"),
  // );

  if (!sortedDownloads.length) {
    return { success: false, error: "No valid download URLs", status: 404 };
  }

  const links = await Promise.all(
    sortedDownloads.map(async (d: any) => {
      const encrypted = await encryptUrl(d.url);
      return {
        resolution: d.resolutions,
        format: d.format,
        size: d.size,
        type: d.url.includes(".m3u8") ? ("hls" as const) : ("mp4" as const),
        link: `${workingProxy}?data=${encodeURIComponent(encrypted)}`,
      };
    }),
  );

  const activeDub =
    dubs.find((d: any) => d.lanCode === activeDubLang) ?? dubs[0];

  return {
    success: true,
    links,
    subtitles,
    dubs: dubs.map((d: any) => ({
      lang: d.lanCode,
      type: d.type,
      name:
        d.type === 1
          ? d.lanName
              .replace(/\b(dub|audio)\b/gi, "")
              .trim()
              .replace(/sub$/i, "")
              .trim() + " (Subtitle)"
          : d.lanName.replace(/\b(dub|audio|sub)\b/gi, "").trim(),
      original: d.original,
    })),
    meow: cached,
    meowmeow: cachedDownloads,
    active: {
      langCode: activeDub?.lanCode ?? "",
      langType: activeDub?.type ?? 0,
      langName:
        activeDub?.lanName?.replace(/\b(dub|audio)\b/gi, "").trim() ?? "",
    },
    top: false,
    fallback: dubCode ? dubCode !== activeDub?.lanCode : false,
  };
}
export { getWorkingProxy };
