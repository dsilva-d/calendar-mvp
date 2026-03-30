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
    title: event.summary || "(Untitled event)",
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

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseEventDate(value: string) {
  if (!value) return new Date("");
  return new Date(value);
}

function isDateOnlyString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatEventTime(value: string) {
  if (!value || isDateOnlyString(value)) {
    return "All day";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid time";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString([], {
    weekday: "short",
  });
}

function formatDayNumber(date: Date) {
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function buildUpcomingWeek(daysSource: Date) {
  const start = new Date(daysSource);
  start.setHours(0, 0, 0, 0);

  const days: Date[] = [];

  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }

  return days;
}

function formatSuggestionType(type: string) {
  switch (type) {
    case "move_meeting":
      return "Move meeting";
    case "create_focus_block":
      return "Create focus block";
    case "reduce_recurring_meetings":
      return "Reduce recurring meetings";
    case "protect_morning_focus":
      return "Protect morning focus";
    default:
      return type
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
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

  const weekStart = useMemo(() => {
    if (classified.length > 0) {
      const firstValidEvent = classified.find(
        (event) => !Number.isNaN(parseEventDate(event.start).getTime())
      );

      if (firstValidEvent) {
        const date = parseEventDate(firstValidEvent.start);
        date.setHours(0, 0, 0, 0);
        return date;
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, [classified]);

  const weekDays = useMemo(() => buildUpcomingWeek(weekStart), [weekStart]);

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, ReturnType<typeof classifyEvent>[]> = {};

    classified.forEach((event) => {
      const startDate = parseEventDate(event.start);

      if (Number.isNaN(startDate.getTime())) return;

      const key = toDateKey(startDate);

      if (!grouped[key]) {
        grouped[key] = [];
      }

      grouped[key].push(event);
    });

    Object.values(grouped).forEach((events) => {
      events.sort(
        (a, b) =>
          parseEventDate(a.start).getTime() - parseEventDate(b.start).getTime()
      );
    });

    return grouped;
  }, [classified]);

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
    async function initializeCalendar() {
      try {
        setError("");
  
        const response = await fetch(`/api/auth/status`, {
          credentials: "include",
        });
  
        if (!response.ok) {
          loadMockCalendar();
          return;
        }
  
        const data = await response.json();
  
        if (data.authenticated) {
          await loadRealCalendar();
        } else {
          loadMockCalendar();
        }
      } catch (err) {
        loadMockCalendar();
      }
    }
  
    initializeCalendar();
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
                  <Text style={styles.suggestionType}>
                    {formatSuggestionType(suggestion.type)}
                  </Text>
                  <Text>{suggestion.reason}</Text>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Upcoming Week</Text>

        {classified.length === 0 ? (
          <Text>No upcoming events found. Try connecting your calendar.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.weekViewRow}>
              {weekDays.map((day) => {
                const key = toDateKey(day);
                const dayEvents = eventsByDate[key] || [];
                const todayKey = toDateKey(new Date());
                const isToday = key === todayKey;

                return (
                  <View
                    key={key}
                    style={[styles.weekDayColumn, isToday && styles.todayCard]}
                  >
                    <Text style={styles.weekDayLabel}>{formatDayLabel(day)}</Text>
                    <Text style={styles.weekDayDate}>{formatDayNumber(day)}</Text>

                    {dayEvents.length === 0 ? (
                      <Text style={styles.emptyDayText}>No events</Text>
                    ) : (
                      dayEvents.map((event) => {

                        return (
                          <View key={event.id} style={styles.calendarEventCard}>
                            <Text style={styles.calendarEventTime}>
                              {formatEventTime(event.start)}
                            </Text>
                            <Text style={styles.calendarEventTitle}>
                              {event.title}
                            </Text>
                            <Text style={styles.calendarEventMeta}>
                              Rule: {event.classification.type} ·{" "}
                              {event.classification.priority}
                            </Text>
                          </View>
                        );
                      })
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>
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
  weekViewRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  weekDayColumn: {
    width: 240,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#ffffff",
  },
  todayCard: {
    backgroundColor: "#eff6ff",
    borderColor: "#93c5fd",
  },
  weekDayLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  weekDayDate: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },
  emptyDayText: {
    color: "#9ca3af",
    fontStyle: "italic",
  },
  calendarEventCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  calendarEventTime: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    marginBottom: 2,
  },
  calendarEventTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  calendarEventMeta: {
    fontSize: 12,
    color: "#4b5563",
  },
  suggestionBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#eef2ff",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    marginBottom: 6,
  },
  suggestionBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4338ca",
  },
  suggestionType: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 4,
  },
});