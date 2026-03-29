import { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import mockCalendar from "../../src/data/mockCalendar.json";

type NormalizedEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  attendeeCount: number;
  isRecurring: boolean;
  status: string;
};

type AiAnalysis = {
  eventClassifications: {
    id: string;
    type:
      | "one_on_one"
      | "interview"
      | "planning"
      | "review"
      | "standup"
      | "sync"
      | "focus_block"
      | "personal"
      | "other";
    priority: "high" | "medium" | "low";
    reason: string;
  }[];
  insights: string[];
  suggestions: {
    type:
      | "move_meeting"
      | "create_focus_block"
      | "reduce_recurring_meetings"
      | "protect_morning_focus";
    title: string;
    reason: string;
  }[];
};

function normalizeGoogleEvents(calendarResponse: any): NormalizedEvent[] {
  return (calendarResponse.items || []).map((event: any) => ({
    id: event.id,
    title: event.summary || "",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    attendeeCount: event.attendees?.length || 0,
    isRecurring: Boolean(event.recurrence?.length),
    status: event.status || "confirmed",
  }));
}

function classifyEvent(event: NormalizedEvent) {
  const title = event.title.toLowerCase();

  let priority: "high" | "medium" | "low" = "medium";
  let type:
    | "one_on_one"
    | "interview"
    | "planning"
    | "review"
    | "standup"
    | "sync"
    | "other" = "other";

  if (title.includes("1:1")) {
    type = "one_on_one";
    priority = "high";
  } else if (title.includes("interview")) {
    type = "interview";
    priority = "high";
  } else if (title.includes("planning")) {
    type = "planning";
    priority = "high";
  } else if (title.includes("review")) {
    type = "review";
    priority = "high";
  } else if (title.includes("standup")) {
    type = "standup";
    priority = "medium";
  } else if (title.includes("sync") || title.includes("check-in")) {
    type = "sync";
    priority = event.isRecurring ? "low" : "medium";
  }

  return {
    ...event,
    classification: {
      type,
      priority,
    },
  };
}

function getDurationHours(start: string, end: string) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
}

function analyzeSchedule(events: ReturnType<typeof classifyEvent>[]) {
  const totalMeetings = events.length;

  const totalMeetingHours = events.reduce(
    (sum, event) => sum + getDurationHours(event.start, event.end),
    0
  );

  const lowPriorityMeetings = events.filter(
    (event) => event.classification.priority === "low"
  );

  const recurringMeetings = events.filter((event) => event.isRecurring);

  return {
    totalMeetings,
    totalMeetingHours: totalMeetingHours.toFixed(1),
    lowPriorityCount: lowPriorityMeetings.length,
    recurringCount: recurringMeetings.length,
    insights: [
      totalMeetingHours > 10
        ? "This looks like a meeting-heavy week."
        : "This week has a manageable meeting load.",
      lowPriorityMeetings.length > 0
        ? "You have low-priority meetings that may be movable."
        : "No obvious low-priority meetings were found.",
    ],
  };
}

export default function HomeScreen() {
  const [calendarData, setCalendarData] = useState<any>(mockCalendar);
  const [source, setSource] = useState("mock");
  const [error, setError] = useState("");
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);

  const normalized = useMemo(
    () => normalizeGoogleEvents(calendarData),
    [calendarData]
  );

  const classified = useMemo(
    () => normalized.map(classifyEvent),
    [normalized]
  );

  const analysis = useMemo(
    () => analyzeSchedule(classified),
    [classified]
  );

  async function loadRealCalendar() {
    try {
      setLoadingCalendar(true);
      setError("");

      const response = await fetch(`/api/calendar/events`, {
        credentials: "include",
      });

      if (response.status === 401) {
        window.location.href = `/auth/google`;
        return;
      }

      if (!response.ok) {
        let message = `Failed to load calendar (${response.status})`;
      
        try {
          const errorJson = await response.json();
          if (errorJson?.error) {
            message = errorJson.error;
          }
        } catch {
          // keep default message
        }
      
        throw new Error(message);
      }

      const data = await response.json();
      setCalendarData(data);
      setSource("google");
      setAiAnalysis(null);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoadingCalendar(false);
    }
  }

  function loadMockCalendar() {
    setCalendarData(mockCalendar);
    setSource("mock");
    setError("");
    setAiAnalysis(null);
  }

  async function signOut() {
    try {
      await fetch(`/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      // reset state
      setCalendarData(mockCalendar);
      setSource("mock");
      setAiAnalysis(null);
      setError("");
    } catch (err) {
      console.error("Logout failed", err);
    }
  }

  async function analyzeWithAi() {
    try {
      setLoadingAi(true);
      setError("");

      const response = await fetch(`/api/analyze-calendar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          events: normalized,
        }),
      });

      if (!response.ok) {
        let message = "Failed to analyze calendar";

        try {
          const errorJson = await response.json();
          if (errorJson?.error) {
            message = errorJson.error;
          }
        } catch {
          // keep default message
        }

        throw new Error(message);
      }

      const data = await response.json();
      setAiAnalysis(data);
    } catch (err: any) {
      setError(err.message || "AI analysis failed");
    } finally {
      setLoadingAi(false);
    }
  }

  useEffect(() => {
    loadMockCalendar();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Schedule Analyzer</Text>

      <View
        style={[
          styles.sourceBadge,
          source === "mock" ? styles.mockBadge : styles.googleBadge,
        ]}
      >
        <Text style={styles.sourceBadgeText}>
          {source === "mock" ? "USING MOCK DATA" : "USING GOOGLE CALENDAR"}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={loadMockCalendar}>
          <Text style={styles.buttonText}>Load Mock Calendar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={loadRealCalendar}>
          <Text style={styles.buttonText}>
            {loadingCalendar ? "Loading..." : "Connect Google Calendar"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={analyzeWithAi}>
          <Text style={styles.buttonText}>
            {loadingAi ? "Analyzing..." : "Analyze with AI"}
          </Text>
        </TouchableOpacity>
        {source === "google" && (
          <TouchableOpacity style={styles.button} onPress={signOut}>
            <Text style={styles.buttonText}>Sign Out</Text>
          </TouchableOpacity>
        )}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Summary</Text>
        <Text>Total meetings: {analysis.totalMeetings}</Text>
        <Text>Total meeting hours: {analysis.totalMeetingHours}</Text>
        <Text>Recurring meetings: {analysis.recurringCount}</Text>
        <Text>Low-priority meetings: {analysis.lowPriorityCount}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rule-Based Insights</Text>
        {analysis.insights.map((insight, index) => (
          <Text key={index} style={styles.listItem}>
            • {insight}
          </Text>
        ))}
      </View>

      {aiAnalysis ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>AI Insights</Text>
            {aiAnalysis.insights.map((insight, index) => (
              <Text key={index} style={styles.listItem}>
                • {insight}
              </Text>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>AI Suggestions</Text>
            {aiAnalysis.suggestions.length === 0 ? (
              <Text>No suggestions returned.</Text>
            ) : (
              aiAnalysis.suggestions.map((suggestion, index) => (
                <View key={index} style={styles.eventRow}>
                  <Text style={styles.eventTitle}>{suggestion.title}</Text>
                  <Text>{suggestion.type}</Text>
                  <Text>{suggestion.reason}</Text>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sample Events</Text>

        {classified.length === 0 ? (
          <Text>No upcoming events found. Try connecting your calendar.</Text>
        ) : (
          classified.slice(0, 5).map((event) => {
            const aiMatch = aiAnalysis?.eventClassifications.find(
              (item) => item.id === event.id
            );

            return (
              <View key={event.id} style={styles.eventRow}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text>
                  Rule: {event.classification.type} ·{" "}
                  {event.classification.priority}
                </Text>
                {aiMatch ? (
                  <>
                    <Text>
                      AI: {aiMatch.type} · {aiMatch.priority}
                    </Text>
                    <Text>{aiMatch.reason}</Text>
                  </>
                ) : null}
                <Text>{event.attendeeCount} attendees</Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#f5f7fb",
    minHeight: "100%",
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 10,
  },
  sourceBadge: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginBottom: 16,
  },
  mockBadge: {
    backgroundColor: "#fde68a",
  },
  googleBadge: {
    backgroundColor: "#bbf7d0",
  },
  sourceBadgeText: {
    fontWeight: "700",
    color: "#111827",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  button: {
    backgroundColor: "#111827",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  buttonText: {
    color: "white",
    fontWeight: "600",
  },
  errorText: {
    color: "red",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 10,
  },
  listItem: {
    marginBottom: 6,
  },
  eventRow: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
});