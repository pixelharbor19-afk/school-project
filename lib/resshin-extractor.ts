// @/lib/resshin-extractor.ts
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { encryptUrl } from "./encryptor.ts";

// ==================== CONFIG ====================
const GATEWAY_SECRET = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const BOTTOM_TAB_URL =
  "https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/bottom-tab";
const BOTTOM_TAB_CLIENT_TOKEN =
  "1782204604620,cea850d15d46b9b316c073ba0ad05f2f";

const supabase = createClient(
  process.env.SUPABASE_URL_MOVIEBOX_APP!,
  process.env.SUPABASE_SERVICE_ROLE_KEY_MOVIEBOX_APP!,
);

let cachedServerJwt: string | null = null;
let cachedServerJwtPromise: Promise<string> | null = null;
let cachedDevice = { deviceId: "", gaid: "", timestamp: 0 };

// ==================== HELPERS ====================
function getDeviceCredentials() {
  const now = Date.now();
  if (!cachedDevice.deviceId || now - cachedDevice.timestamp > 43200000) {
    cachedDevice = {
      deviceId: crypto.randomBytes(16).toString("hex"),
      gaid: [
        crypto.randomBytes(4).toString("hex"),
        crypto.randomBytes(2).toString("hex"),
        crypto.randomBytes(2).toString("hex"),
        crypto.randomBytes(2).toString("hex"),
        crypto.randomBytes(6).toString("hex"),
      ].join("-"),
      timestamp: now,
    };
  }
  return cachedDevice;
}

function normalizeQuery(qs: string): string {
  if (!qs) return "";
  const pairs: [string, string][] = [];
  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const key = idx === -1 ? pair : pair.slice(0, idx);
    const val = idx === -1 ? "" : pair.slice(idx + 1);
    try {
      pairs.push([decodeURIComponent(key), decodeURIComponent(val)]);
    } catch {
      pairs.push([key, val]);
    }
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function bodyMd5(body: string): string {
  if (!body) return "";
  const buf = Buffer.from(body, "utf8");
  const chunk = buf.length > 102400 ? buf.subarray(0, 102400) : buf;
  return crypto.createHash("md5").update(chunk).digest("hex");
}

function buildCanonical(
  method: string,
  headers: Record<string, string>,
  body: string,
  fullUrl: string,
  ts: number,
): string {
  const u = new URL(fullUrl);
  const accept = headers["accept"] ?? "";
  const contentType = headers["content-type"] ?? "";
  let contentLength = headers["content-length"] ?? "";
  if (!contentLength && body)
    contentLength = String(Buffer.byteLength(body, "utf8"));
  if (method.toUpperCase() === "GET" && !body) contentLength = "";
  const md5 = bodyMd5(body);
  const normalizedQuery = normalizeQuery(u.search.replace(/^\?/, ""));
  const pathUrl = u.pathname + (normalizedQuery ? `?${normalizedQuery}` : "");
  return [
    method.toUpperCase(),
    accept,
    contentType,
    contentLength,
    String(ts),
    md5,
    pathUrl,
  ].join("\n");
}

function sign(secretB64: string, canonical: string): string {
  const key =
    /^[A-Za-z0-9+/=]+$/.test(secretB64) && secretB64.length % 4 === 0
      ? Buffer.from(secretB64, "base64")
      : Buffer.from(secretB64, "utf8");
  const h = crypto.createHmac("md5", key);
  h.update(canonical, "utf8");
  return h.digest("base64");
}

function makeXTr(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): string {
  const ts = Date.now();
  const canonical = buildCanonical(method, headers, body, url, ts);
  return `${ts}|2|${sign(GATEWAY_SECRET, canonical)}`;
}

async function getServerJwt(): Promise<string> {
  if (cachedServerJwt) return cachedServerJwt;
  if (cachedServerJwtPromise) return cachedServerJwtPromise;

  cachedServerJwtPromise = (async () => {
    const device = getDeviceCredentials();
    const headers: Record<string, string> = {
      accept: "*/*",
      "accept-encoding": "gzip, deflate, br",
      connection: "keep-alive",
      host: "api3.aoneroom.com",
      "user-agent":
        "com.community.mbox.in.geobypass/51042203 (Linux; U; Android 7.1.2; en_US; SM-G955N; Build/NRD90M.G955NKSU1AQDC; Cronet/104.0.5112.46)",
      "x-client-info": JSON.stringify({
        package_name: "com.community.mbox.in.geobypass",
        version_name: "3.0.14.0422.03",
        version_code: 51042203,
        os: "android",
        os_version: "7.1.2",
        device_id: device.deviceId,
        gaid: device.gaid,
        brand: "samsung",
        model: "SM-G955N",
        system_language: "en",
        net: "NETWORK_WIFI",
        region: "US",
        timezone: "Africa/Brazzaville",
        sp_code: "20801",
        "X-Play-Mode": "2",
        "X-Family-Mode": "0",
      }),
      "x-client-status": "0",
      "x-client-token": BOTTOM_TAB_CLIENT_TOKEN,
      "x-family-mode": "0",
      "x-play-mode": "2",
    };

    headers["x-tr-signature"] = makeXTr("GET", BOTTOM_TAB_URL, headers, "");
    headers["x-tr-signature-method"] = "HmacMD5";

    const res = await fetch(BOTTOM_TAB_URL, { method: "GET", headers });
    const xuser = res.headers.get("x-user") || res.headers.get("X-User");
    if (!xuser) throw new Error("Failed to get JWT");

    let token = xuser;
    try {
      const parsed = JSON.parse(xuser);
      if (parsed?.token) token = parsed.token;
    } catch {}
    cachedServerJwt = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    return cachedServerJwt;
  })();

  return cachedServerJwtPromise;
}

async function gatewayRequest(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
) {
  const authToken = await getServerJwt();
  const headers: Record<string, string> = {
    accept: "*/*",
    authorization: authToken,
    "accept-encoding": "gzip, deflate, br",
    "user-agent":
      "com.community.mbox.in.geobypass/51042203 (Linux; U; Android 7.1.2; en_US; SM-G955N; Build/NRD90M.G955NKSU1AQDC; Cronet/104.0.5112.46)",
    "x-client-info": JSON.stringify({
      ...getDeviceCredentials(),
      timezone: "Africa/Brazzaville",
    }),
    ...opts.headers,
  };

  headers["x-tr-signature"] = makeXTr(method, url, headers, opts.body ?? "");
  headers["x-tr-signature-method"] = "HmacMD5";

  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? opts.body : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    cachedServerJwt = null;
    return gatewayRequest(method, url, opts);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, raw: text };
  }
}

async function gatewaySearch(keyword: string) {
  return gatewayRequest(
    "POST",
    "https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/search/v2",
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword, page: 1, perPage: 20 }),
    },
  );
}

async function gatewayGetSubject(subjectId: string) {
  return gatewayRequest(
    "GET",
    `https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(subjectId)}`,
  );
}

async function gatewayGetResource(
  subjectId: string,
  query: Record<string, string> = {},
) {
  const params = {
    ...query,
    all: query.all ?? "0",
    page: query.page ?? "1",
    perPage: query.perPage ?? "5",
    subjectId,
  };
  const qs = new URLSearchParams(params).toString();
  return gatewayRequest(
    "GET",
    `https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/resource?${qs}`,
  );
}

function extractQualities(list: any[]): any[] {
  const groups = new Map();
  for (const item of list ?? []) {
    if (!item || typeof item !== "object") continue;
    const url = item.url || item.resourceLink || item.link;
    if (!url) continue;
    const resolution = String(item.resolution || "1080");
    const quality = {
      resolution,
      url,
      size: Number(item.size) || 0,
      format: "mp4",
    };
    const key = resolution;
    const existing = groups.get(key);
    if (!existing || quality.size > existing.size) {
      groups.set(key, quality);
    }
  }
  return Array.from(groups.values()).sort(
    (a, b) => parseInt(b.resolution) - parseInt(a.resolution),
  );
}

async function fetchSubjectQualities(
  subject: any,
  baseQuery: Record<string, string> = {},
) {
  const allItems: any[] = [];

  const first = await gatewayGetResource(subject.subjectId, baseQuery);
  allItems.push(...(first?.data?.list ?? []));

  for (const resolution of ["360", "480", "720", "1080"]) {
    const res = await gatewayGetResource(subject.subjectId, {
      ...baseQuery,
      resolution,
    });

    if (res?.code === 0) {
      allItems.push(...(res?.data?.list ?? []));
    }
  }

  return extractQualities(allItems);
}

// ==================== MAIN EXTRACTION ====================
export type ResshinExtractInput = {
  tmdbId: string;
  mediaType: string;
  title: string;
  date: string;
  season?: string | null;
  episode?: string | null;
  dubCode?: string | null;
  dubType?: number;
};

export type ResshinExtractResult =
  | {
      success: true;
      links: Array<{
        resolution: string;
        format: string;
        size: number;
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

export async function extractResshin(
  input: ResshinExtractInput,
): Promise<ResshinExtractResult> {
  const {
    tmdbId,
    mediaType,
    title,
    date,
    season,
    episode,
    dubCode,
    dubType = 0,
  } = input;

  // -------- Cache Lookup (dubs) --------
  let dubs: any[];

  const { data: cached } = await supabase
    .from("moviebox_cache")
    .select("dubs")
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .maybeSingle();

  if (cached) {
    dubs = cached.dubs ?? [];
  } else {
    const year = date ? new Date(date).getFullYear().toString() : null;
    const keyword = `${title} ${year || ""}`.trim();

    const search = await gatewaySearch(keyword);
    if (search?.code !== 0) {
      return { success: false, error: "No search results", status: 404 };
    }

    const subjects = (search.data?.results || []).flatMap(
      (r: any) => r.subjects || [],
    );
    const filtered = subjects.filter(
      (s: any) => s.subjectType === (mediaType === "movie" ? 1 : 2),
    );

    if (!filtered.length) {
      return { success: false, error: "No matching content", status: 404 };
    }

    const normalizedTitle = title.toLowerCase().trim().replace(/-/g, " ");

    const LANG_TAGS =
      /\[(tagalog|hindi|dubbed|multi|spanish|french|arabic|korean|japanese|tamil|telugu)\]/i;

    const queryWords = normalizedTitle.split(/\s+/).filter(Boolean);
    const dateObj = date ? new Date(date) : null;

    const primary = filtered.find((item: any) => {
      const itemTitle = item.title?.toLowerCase().replace(/-/g, " ") || "";
      const itemReleaseDate = item.releaseDate;

      if (LANG_TAGS.test(itemTitle)) return false;
      if (!dateObj || !itemReleaseDate) return false;

      const itemDate = new Date(itemReleaseDate);
      const diff =
        itemDate.getFullYear() * 12 +
        itemDate.getMonth() -
        (dateObj.getFullYear() * 12 + dateObj.getMonth());

      if (Math.abs(diff) > 1) return false;

      const itemTitleClean = itemTitle.replace(/\bs\d+(-s\d+)?\b/gi, "").trim();
      const itemWordsClean = itemTitleClean.split(/\s+/).filter(Boolean);

      if (
        queryWords.length <= 2 &&
        itemWordsClean.length !== queryWords.length
      ) {
        return false;
      }

      return queryWords.every((word) => itemTitle.includes(word));
    });

    if (!primary) {
      return { success: false, error: "No matching title", status: 404 };
    }

    const subjectDetails = await gatewayGetSubject(primary.subjectId);

    dubs = subjectDetails?.data?.dubs ?? [];

    if (!dubs.length) {
      dubs = [
        {
          subjectId: primary.subjectId,
          lanCode: "orig",
          lanName: "Original Audio",
          original: true,
          type: 0,
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

  const original =
    dubs.find((d: any) => d.original) ??
    dubs.find((d: any) => d.lanCode === "en") ??
    dubs[0];

  let activeDub = original;

  if (dubCode) {
    const found = dubs.find(
      (d: any) => d.lanCode === dubCode && Number(d.type ?? 0) === dubType,
    );
    if (found) activeDub = found;
  }

  const activeDubLang: string = activeDub?.lanCode ?? "orig";
  const activeDubType: number = activeDub?.type ?? 0;

  // -------- Cache Lookup (downloads) --------
  let sortedDownloads: any[];
  let subtitles: any[] = [];

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

  const { data: cachedDownloads } = await dlQuery.maybeSingle();
  if (cachedDownloads) {
    sortedDownloads = cachedDownloads.downloads ?? [];
  } else {
    const baseQuery: Record<string, string> =
      mediaType === "tv"
        ? {
            all: "0",
            page: "1",
            perPage: "5",
            se: String(season || 1),
            ep: String(episode || 1),
            epFrom: String(episode || 1),
            epTo: String(episode || 1),
            startPosition: String(episode || 1),
            endPosition: String(episode || 1),
            pagerMode: "2",
          }
        : {};

    let qualities = await fetchSubjectQualities(
      { subjectId: activeDub.subjectId },
      baseQuery,
    );
    let fallback = false;

    if (!qualities.length && activeDub.subjectId !== original.subjectId) {
      fallback = true;
      activeDub = original;
      qualities = await fetchSubjectQualities(
        { subjectId: original.subjectId },
        baseQuery,
      );
    }

    sortedDownloads = qualities
      .filter((q: any) => q?.url && typeof q.url === "string")
      .sort(
        (a: any, b: any) =>
          (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0),
      );

    if (!sortedDownloads.length) {
      return { success: false, error: "No download sources", status: 404 };
    }
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
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 45).toISOString(),
        refreshed_at: new Date().toISOString(),
      },
      {
        onConflict: "tmdb_id,media_type,season,episode,dub,type",
      },
    );
  }
  const PREFERRED_ORDER = ["720", "480", "1080", "360"];
  // const links = sortedDownloads.map((q: any) => ({
  //   resolution: q.resolution,
  //   format: q.format,
  //   size: q.size,
  //   type: (q.url ?? "").includes(".m3u8") ? ("hls" as const) : ("mp4" as const),
  //   link: `https://proxy.zxcstream.xyz/proxy?url=${encodeURIComponent(q.url)}`,
  // }));
  const links = await Promise.all(
    PREFERRED_ORDER.map((res) =>
      sortedDownloads.find(
        (q: any) => String(q.resolution).replace(/p$/i, "") === res,
      ),
    )
      .filter(Boolean)
      .map(async (q: any) => {
        const expiresAt = Date.now() + 5 * 60 * 60 * 1000;
        const payload = `${expiresAt}|${q.url}`;
        const encrypted = await encryptUrl(payload);
        return {
          resolution: q.resolution,
          format: q.format,
          size: q.size,
          type: (q.url ?? "").includes(".m3u8")
            ? ("hls" as const)
            : ("mp4" as const),
          link: `https://proxy.zxcstream.xyz/proxy?data=${encodeURIComponent(encrypted)}`,
        };
      }),
  );
  const active = dubs.find((d: any) => d.lanCode === activeDubLang) ?? dubs[0];

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
    active: {
      langCode: active?.lanCode ?? "",
      langType: active?.type ?? 0,
      langName: active?.lanName?.replace(/\b(dub|audio)\b/gi, "").trim() ?? "",
    },
    top: false,
    fallback: dubCode ? dubCode !== active?.lanCode : false,
  };
}
