const allowedDimensions = new Set(["Browser", "Device", "Country/Region", "OS", "Source", "Medium", "Campaign", "Channel", "URL"]);

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) {
    return Response.json({ ok: false, configured: false, error: "CLARITY_API_TOKEN fehlt." }, { status: 503 });
  }

  const input = new URL(request.url).searchParams;
  const parsedDays = Number(input.get("days") || "1");
  const days = [1, 2, 3].includes(parsedDays) ? parsedDays : 1;
  const dimensions = [input.get("dimension1"), input.get("dimension2"), input.get("dimension3")]
    .filter((value): value is string => Boolean(value))
    .filter((value) => allowedDimensions.has(value));

  const url = new URL("https://www.clarity.ms/export-data/api/v1/project-live-insights");
  url.searchParams.set("numOfDays", String(days));
  dimensions.forEach((dimension, index) => url.searchParams.set(`dimension${index + 1}`, dimension));

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      next: { revalidate: 21_600 },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return Response.json(
        {
          ok: false,
          configured: true,
          error: response.status === 429 ? "Clarity-Tageslimit erreicht." : `Clarity antwortet mit HTTP ${response.status}.`,
          detail: detail.slice(0, 300),
        },
        { status: response.status },
      );
    }

    const data = await response.json();
    return Response.json({
      ok: true,
      configured: true,
      days,
      dimensions,
      fetchedAt: new Date().toISOString(),
      data,
    });
  } catch (error) {
    return Response.json(
      { ok: false, configured: true, error: error instanceof Error ? error.message : "Clarity konnte nicht abgefragt werden." },
      { status: 502 },
    );
  }
}
