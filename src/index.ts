import "dotenv/config";
import express from "express";
import { extractResshin } from "../lib/resshin-extractor.ts";

const app = express();

app.get("/resshin", async (req, res) => {
  const { tmdbId, mediaType, title, date, season, episode, dubCode, dubType } =
    req.query;

  if (!tmdbId || !mediaType || !title || !date) {
    return res.status(400).json({
      success: false,
      error: "Missing required query parameters",
      required: ["tmdbId", "mediaType", "title", "date"],
    });
  }

  try {
    const result = await extractResshin({
      tmdbId: tmdbId as string,
      mediaType: mediaType as string,
      title: title as string,
      date: date as string,
      season: season as string | undefined,
      episode: episode as string | undefined,
      dubCode: dubCode as string | undefined,
      dubType: Number(dubType ?? "0"),
    });

    return res.status(result.success ? 200 : result.status).json(result);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal Server Error",
    });
  }
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
