import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as CalendarIcon, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { z } from "zod";

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  created_at: string;
  user_id: string;
  profiles?: { full_name: string };
}

interface ClassCalendarProps {
  classId: string;
}

export const ClassCalendar = ({ classId }: ClassCalendarProps) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedTime, setSelectedTime] = useState("12:00");
  const [currentUserId, setCurrentUserId] = useState<string>("");

  useEffect(() => {
    loadEvents();
    getCurrentUser();

    const channel = supabase
      .channel(`calendar-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_events",
          filter: `class_id=eq.${classId}`,
        },
        () => loadEvents()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId]);

  const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);
  };

  const loadEvents = async () => {
    const { data, error } = await supabase
      .from("calendar_events")
      .select("*")
      .eq("class_id", classId)
      .order("event_date", { ascending: true });

    if (error) {
      toast.error("Failed to load events");
      return;
    }

    const userIds = [...new Set(data?.map(e => e.user_id) || [])];
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    const profilesMap = new Map(profilesData?.map(p => [p.id, p]));

    const eventsWithProfiles = data?.map(event => ({
      ...event,
      profiles: profilesMap.get(event.user_id) || { full_name: "Unknown" }
    })) || [];

    setEvents(eventsWithProfiles);
  };

  const eventSchema = z.object({
    title: z.string()
      .trim()
      .min(1, "Title is required")
      .max(200, "Title must be less than 200 characters")
      .regex(/^[a-zA-Z0-9\s\-&.!?,()]+$/, "Title contains invalid characters"),
    description: z.string()
      .trim()
      .max(1000, "Description must be less than 1000 characters")
      .optional(),
    eventDate: z.date({
      required_error: "Event date is required"
    })
  });

  const handleCreateEvent = async () => {
    try {
      if (!selectedDate) {
        toast.error("Please select a date");
        return;
      }

      const validated = eventSchema.parse({
        title,
        description: description || undefined,
        eventDate: selectedDate
      });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [hours, minutes] = selectedTime.split(":");
      const eventDateTime = new Date(validated.eventDate);
      eventDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const { error } = await supabase.from("calendar_events").insert({
        class_id: classId,
        user_id: user.id,
        title: validated.title,
        description: validated.description || null,
        event_date: eventDateTime.toISOString(),
      });

      if (error) {
        toast.error("Failed to create event");
        return;
      }

      toast.success("Event created");
      setTitle("");
      setDescription("");
      setSelectedTime("12:00");
      setShowForm(false);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else {
        toast.error("Failed to create event");
      }
    }
  };

  const handleDeleteEvent = async (id: string) => {
    const { error } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete event");
      return;
    }
    toast.success("Event deleted");
  };

  const upcomingEvents = events.filter(
    (event) => new Date(event.event_date) >= new Date()
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <CalendarIcon className="w-5 h-5" />
          Class Calendar
        </h3>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          {showForm ? "Cancel" : "Add Event"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Input
              placeholder="Event Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex-1">
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-32"
              />
            </div>
            <Button onClick={handleCreateEvent} className="w-full">
              Create Event
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-medium">Upcoming Events</h4>
        {upcomingEvents.map((event) => (
          <Card key={event.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-base">{event.title}</CardTitle>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(event.event_date), "PPP 'at' p")}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    By {event.profiles?.full_name}
                  </p>
                </div>
                {event.user_id === currentUserId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteEvent(event.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            {event.description && (
              <CardContent>
                <p className="text-sm">{event.description}</p>
              </CardContent>
            )}
          </Card>
        ))}
        {upcomingEvents.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No upcoming events
          </p>
        )}
      </div>
    </div>
  );
};
