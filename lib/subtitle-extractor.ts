import { fetchWithTimeout } from "./fetch-timeout.ts";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL_MOVIEBOX_WEB!,
  process.env.SUPABASE_SERVICE_ROLE_KEY_MOVIEBOX_WEB!,
);

// ==================== TYPES ====================
export interface MediaOption {
  id: string;
  display: string;
  file: string;
}
export type IcarusExtractInput = {
  tmdbId: string;
  mediaType: string;
  title: string;
  date: string;
  season?: string | null;
  episode?: string | null;
};

export type IcarusExtractResult =
  | {
      success: true;
      subtitles: MediaOption[];
    }
  | {
      success: false;
      error: string;
      status: number;
    };

// ==================== HELPERS ====================
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

// ==================== MAIN ====================
export async function extractSubtitle(
  input: IcarusExtractInput,
): Promise<IcarusExtractResult> {
  const { tmdbId, mediaType, title, date, season, episode } = input;

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

  // -------- Read-only cache lookup for subjectId / detailPath --------
  let subjectId: string | null = null;
  let detailPath: string | null = null;

  const { data: cached } = await supabase
    .from("moviebox_cache")
    .select("dubs")
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .maybeSingle();

  if (cached?.dubs?.length) {
    const entry =
      cached.dubs.find((d: any) => d.original === true) ??
      cached.dubs.find((d: any) => d.lanCode === "en") ??
      cached.dubs[0];
    subjectId = entry?.subjectId ?? null;
    detailPath = entry?.detailPath ?? null;
  }

  if (!subjectId || !detailPath) {
    // No usable cache → search + detail (read-only, no upsert)
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

    const selectedItem =
      items.find((item: any) => matchesItem(item, true)) ??
      items.find((item: any) => matchesItem(item, false));

    if (!selectedItem) {
      return { success: false, error: "Unavailable", status: 404 };
    }

    subjectId = selectedItem.subjectId ?? null;
    detailPath = selectedItem.detailPath ?? null;

    if (!subjectId || !detailPath) {
      return { success: false, error: "SubjectId Not Found", status: 404 };
    }
  }

  // -------- Get stream id + format from play endpoint --------
  const se = mediaType === "tv" ? (season ?? "0") : "0";
  const ep = mediaType === "tv" ? (episode ?? "0") : "0";

  const playUrl = `${baseUrl}/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}&streamSignType=1`;
  const playHeaders = {
    ...headers,
    Referer: `https://movibox.net/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`,
    Origin: "https://movibox.net",
  };

  const playRes = await fetchWithTimeout(
    playUrl,
    { headers: playHeaders },
    8000,
  );
  const playJson = await playRes.json();
  const playData = playJson?.data || {};

  const streams = playData.streams || [];
  const dash = playData.dash || [];

  let streamId: string | null = null;
  let streamFormat = "MP4";

  if (streams.length) {
    streamId = streams[0]?.id ?? null;
    streamFormat = streams[0]?.format || "MP4";
  } else if (dash.length) {
    streamId = dash[0]?.id ?? null;
    streamFormat = dash[0]?.format || "DASH";
  }

  if (!streamId) {
    return {
      success: false,
      error: "No stream id available for captions",
      status: 404,
    };
  }

  // -------- Fetch captions only --------
  const captionUrl = `${baseUrl}/subject/caption?format=${streamFormat}&id=${streamId}&subjectId=${subjectId}&detailPath=${detailPath}`;

  const captionRes = await fetchWithTimeout(
    captionUrl,
    {
      headers: {
        ...headers,
        Referer: `https://movibox.net/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`,
        Origin: "https://movibox.net",
      },
    },
    8000,
  );

  const captionJson = await captionRes.json();

  if (captionJson?.code !== 0) {
    return {
      success: false,
      error: captionJson?.message || "Caption request failed",
      status: 502,
    };
  }

  const rawCaptions = captionJson?.data?.captions || [];

  const subtitles: MediaOption[] = rawCaptions.map((c: any) => ({
    id: String(c.lan ?? c.id ?? ""),
    display: c.lanName || c.lan || "",
    file: c.url || "",
  }));
  return {
    success: true,
    subtitles,
  };
}
