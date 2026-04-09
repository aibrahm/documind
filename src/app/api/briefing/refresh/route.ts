// src/app/api/briefing/refresh/route.ts
//
// Force-regenerates the landing page briefing, bypassing the 1-hour
// cache. Called by the refresh button on the briefing block in the
// workspace home. Returns the freshly-generated briefing payload so
// the client can update the UI without a full page reload.

import { NextResponse } from "next/server";
import { generateDailyBriefing } from "@/lib/daily-briefing";

export async function POST() {
  const briefing = await generateDailyBriefing({ force: true });
  return NextResponse.json({ briefing });
}
