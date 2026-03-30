import express from "express";
import cors from "cors";
import session from "express-session";
import dotenv from "dotenv";
import { google } from "googleapis";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();

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
  
      const { events } = req.body;
  
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: "events must be an array" });
      }
  
      const trimmedEvents = events.slice(0, 50).map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        attendeeCount: event.attendeeCount ?? 0,
        isRecurring: Boolean(event.isRecurring),
        status: event.status ?? "confirmed",
      }));
  
      console.log("[analyze] event count:", trimmedEvents.length);
  
      const prompt = `
  You analyze a user's upcoming calendar week.
  
  Return practical schedule analysis.
  
  Rules:
  - Recurring generic syncs/check-ins are often low or medium priority.
  - Interviews, 1:1s, roadmap/planning, strategy, and reviews are often medium or high priority.
  - Keep exactly 3 insights.
  - Keep up to 3 suggestions.
  - Every input event must appear exactly once in eventClassifications.
  
  Analyze these normalized calendar events:
  ${JSON.stringify(trimmedEvents)}
      `.trim();
  
      console.log("[analyze] before Gemini call");
  
      const response = await Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                eventClassifications: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      type: {
                        type: Type.STRING,
                        enum: [
                          "one_on_one",
                          "interview",
                          "planning",
                          "review",
                          "standup",
                          "sync",
                          "focus_block",
                          "personal",
                          "other",
                        ],
                      },
                      priority: {
                        type: Type.STRING,
                        enum: ["high", "medium", "low"],
                      },
                      reason: { type: Type.STRING },
                    },
                    required: ["id", "type", "priority", "reason"],
                  },
                },
                insights: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                suggestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: {
                        type: Type.STRING,
                        enum: [
                          "move_meeting",
                          "create_focus_block",
                          "reduce_recurring_meetings",
                          "protect_morning_focus",
                        ],
                      },
                      title: { type: Type.STRING },
                      reason: { type: Type.STRING },
                    },
                    required: ["type", "title", "reason"],
                  },
                },
              },
              required: ["eventClassifications", "insights", "suggestions"],
            },
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Gemini request timed out")), 20000)
        ),
      ]);
  
      console.log("[analyze] after Gemini call");
  
      const text =
        typeof response.text === "function" ? response.text() : response.text;
  
      console.log("[analyze] raw response text:", text);
  
      const parsed = JSON.parse(text);
  
      console.log("[analyze] success in", Date.now() - startedAt, "ms");
      return res.json(parsed);
    } catch (error) {
      console.error("[analyze] Gemini analysis error:", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to analyze calendar",
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