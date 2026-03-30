import express from "express";
import cors from "cors";
import session from "express-session";
import dotenv from "dotenv";
import { google } from "googleapis";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();

function isDateOnlyString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
  
function formatForPrompt(value, timeZone) {
if (!value) return "Unknown time";
if (isDateOnlyString(value)) return `${value} (all day)`;

const date = new Date(value);

if (Number.isNaN(date.getTime())) {
    return value;
}

return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
}).format(date);
}

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:8081";

app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:8081"],
    credentials: true,
  })
);

app.use(express.json());

app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "none",
    },
  })
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

app.get("/auth/google", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: SCOPES,
  });

  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).send("Missing authorization code");
    }

    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;

    res.redirect(FRONTEND_URL);
  } catch (error) {
    console.error("Google callback error:", error);
    res.status(500).send("Google auth failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.tokens),
  });
});

app.get("/api/calendar/events", async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    oauth2Client.setCredentials(req.session.tokens);

    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client,
    });

    const now = new Date();
    const inSevenDays = new Date();
    inSevenDays.setDate(now.getDate() + 7);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: inSevenDays.toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: "startTime",
    });

    res.json(response.data);
  } catch (error) {
    console.error("Calendar fetch error:", error);
    res.status(500).json({ error: "Failed to fetch calendar events" });
  }
});

app.post("/api/analyze-calendar", async (req, res) => {
    try {
      const startedAt = Date.now();
      console.log("[analyze] route hit");
  
      if (!process.env.GEMINI_API_KEY) {
        console.error("[analyze] missing GEMINI_API_KEY");
        return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
      }
  
      const { events, timezone } = req.body;
      const userTimeZone = timezone || "America/New_York";
  
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: "events must be an array" });
      }
  
      const normalizedEvents = events.map((event) => ({
        title: event.title || "Untitled",
        start: formatForPrompt(event.start, userTimeZone),
        end: formatForPrompt(event.end, userTimeZone),
        attendeeCount: event.attendeeCount ?? 0,
        isRecurring: Boolean(event.isRecurring),
        status: event.status ?? "confirmed",
      }));
  
      const compactEvents = normalizedEvents.map((event, index) =>
        [
          `#${index + 1}`,
          event.title,
          event.start,
          event.end,
          `attendees:${event.attendeeCount}`,
          `recurring:${event.isRecurring}`,
          `status:${event.status}`,
        ].join(" | ")
      );
  
      console.log("[analyze] event count:", compactEvents.length);
      console.log("[analyze] before Gemini call");
      console.log("[analyze] timezone:", userTimeZone);
      console.log("[analyze] first compact event:", compactEvents[0]);
  
      const prompt = `
            You are analyzing a user's full upcoming calendar week.

            All event times below are already converted to this timezone: ${userTimeZone}.
            Do not refer to UTC unless explicitly asked.

            Return valid JSON with exactly this shape:
        {
            "insights": ["string", "string", "string"],
            "suggestions": [
            {
                "type": "move_meeting|create_focus_block|reduce_recurring_meetings|protect_morning_focus",
                "title": "string",
                "reason": "string"
            }
            ]
        }
        
        Rules:
        - Use all events provided.
        - Keep exactly 3 insights.
        - Keep up to 3 suggestions.
        - Focus on schedule patterns, overload, recurring meetings, fragmentation, and focus time.
        - Do not include any extra keys.
        - Keep suggestions practical and concise.
        
        Weekly events:
        ${compactEvents.join("\n")}
            `.trim();
  
      const response = await Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Gemini request timed out")), 30000)
        ),
      ]);
  
      console.log("[analyze] after Gemini call");
  
      const text =
        typeof response.text === "function" ? response.text() : response.text;
  
      console.log("[analyze] raw response text:", text);
  
      const parsed = JSON.parse(text);
  
      if (
        !parsed ||
        !Array.isArray(parsed.insights) ||
        !Array.isArray(parsed.suggestions)
      ) {
        throw new Error("Gemini returned invalid JSON shape");
      }
  
      console.log("[analyze] success in", Date.now() - startedAt, "ms");
      return res.json({
        insights: parsed.insights.slice(0, 3),
        suggestions: parsed.suggestions.slice(0, 3),
      });
    } catch (error) {
      console.error("[analyze] Gemini analysis error:", error);
      return res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to analyze calendar",
      });
    }
  });


app.post("/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});