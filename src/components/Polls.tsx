import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { z } from "zod";

interface Poll {
  id: string;
  question: string;
  options: string[];
  created_at: string;
  expires_at: string | null;
  user_id: string;
}

interface PollResponse {
  poll_id: string;
  user_id: string;
  option_index: number;
}

interface PollsProps {
  classId: string;
}

export const Polls = ({ classId }: PollsProps) => {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [responses, setResponses] = useState<PollResponse[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  useEffect(() => {
    loadPolls();
    loadResponses();
    getCurrentUser();

    const pollsChannel = supabase
      .channel(`polls-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "polls",
          filter: `class_id=eq.${classId}`,
        },
        () => loadPolls()
      )
      .subscribe();

    const responsesChannel = supabase
      .channel(`poll-responses-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "poll_responses",
        },
        () => loadResponses()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(pollsChannel);
      supabase.removeChannel(responsesChannel);
    };
  }, [classId]);

  const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);
  };

  const loadPolls = async () => {
    const { data, error } = await supabase
      .from("polls")
      .select("*")
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load polls");
      return;
    }
    const pollsWithOptions = data?.map(poll => ({
      ...poll,
      options: Array.isArray(poll.options) ? poll.options as string[] : []
    })) || [];
    setPolls(pollsWithOptions);
  };

  const loadResponses = async () => {
    const { data, error } = await supabase
      .from("poll_responses")
      .select("*");

    if (error) return;
    setResponses(data || []);
  };

  const pollSchema = z.object({
    question: z.string()
      .trim()
      .min(1, "Question is required")
      .max(300, "Question must be less than 300 characters")
      .regex(/^[a-zA-Z0-9\s\-&.!?,()]+$/, "Question contains invalid characters"),
    options: z.array(
      z.string()
        .trim()
        .min(1, "Option cannot be empty")
        .max(100, "Option must be less than 100 characters")
    )
      .min(2, "At least 2 options are required")
      .max(6, "Maximum 6 options allowed")
  });

  const handleCreatePoll = async () => {
    try {
      const validOptions = options.filter((o) => o.trim());

      const validated = pollSchema.parse({
        question,
        options: validOptions
      });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from("polls").insert({
        class_id: classId,
        user_id: user.id,
        question: validated.question,
        options: validated.options,
      });

      if (error) {
        toast.error("Failed to create poll");
        return;
      }

      toast.success("Poll created");
      setQuestion("");
      setOptions(["", ""]);
      setShowForm(false);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else {
        toast.error("Failed to create poll");
      }
    }
  };

  const handleVote = async (pollId: string, optionIndex: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const existingResponse = responses.find(
      (r) => r.poll_id === pollId && r.user_id === user.id
    );

    if (existingResponse) {
      toast.error("You have already voted on this poll");
      return;
    }

    const { error } = await supabase.from("poll_responses").insert({
      poll_id: pollId,
      user_id: user.id,
      option_index: optionIndex,
    });

    if (error) {
      toast.error("Failed to submit vote");
      return;
    }

    toast.success("Vote submitted");
  };

  const getPollResults = (pollId: string, totalOptions: number) => {
    const pollResponses = responses.filter((r) => r.poll_id === pollId);
    const total = pollResponses.length;
    const results = Array(totalOptions).fill(0);

    pollResponses.forEach((r) => {
      results[r.option_index]++;
    });

    return results.map((count) => ({
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    }));
  };

  const hasUserVoted = (pollId: string) => {
    return responses.some(
      (r) => r.poll_id === pollId && r.user_id === currentUserId
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Polls
        </h3>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          {showForm ? "Cancel" : "Create Poll"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Input
              placeholder="Poll Question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            {options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  placeholder={`Option ${index + 1}`}
                  value={option}
                  onChange={(e) => {
                    const newOptions = [...options];
                    newOptions[index] = e.target.value;
                    setOptions(newOptions);
                  }}
                />
                {options.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setOptions(options.filter((_, i) => i !== index))}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <Button
                variant="outline"
                onClick={() => setOptions([...options, ""])}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Option
              </Button>
            )}
            <Button onClick={handleCreatePoll} className="w-full">
              Create Poll
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {polls.map((poll) => {
          const results = getPollResults(poll.id, poll.options.length);
          const userVoted = hasUserVoted(poll.id);

          return (
            <Card key={poll.id}>
              <CardHeader>
                <CardTitle className="text-base">{poll.question}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {poll.options.map((option, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Button
                        variant={userVoted ? "ghost" : "outline"}
                        onClick={() => handleVote(poll.id, index)}
                        disabled={userVoted}
                        className="w-full justify-start"
                      >
                        {option}
                      </Button>
                    </div>
                    {userVoted && (
                      <div className="space-y-1">
                        <Progress value={results[index].percentage} />
                        <p className="text-xs text-muted-foreground text-right">
                          {results[index].count} votes ({results[index].percentage.toFixed(1)}%)
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {userVoted && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    Total votes: {results.reduce((sum, r) => sum + r.count, 0)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        {polls.length === 0 && (
          <p className="text-center text-muted-foreground py-8">No polls yet</p>
        )}
      </div>
    </div>
  );
};
