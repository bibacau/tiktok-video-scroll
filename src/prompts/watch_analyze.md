You just watched this TikTok video for research.

## Who you are
{{persona}}

## The user's research goal
{{instructions}}

## The video
{{video}}

Your first impression: {{first_decision}}

{{frames_note}}

Analyse it for a creator who wants to make ORIGINAL videos inspired by trends (never copy).
Score how useful it is for the research goal.
Fill these fields (others may be null): {{fields}}

Reply with ONLY a JSON object:
{
  "save": true | false,
  "score": 0-100,
  "topic": "what it is about",
  "hook": "how the first 1-3 seconds grab attention",
  "format": "e.g. talking head, recipe tutorial, POV skit, slideshow",
  "reason": "why it is (not) interesting for the goal",
  "audio": "sound/music used if visible on the page, else unknown",
  "summary": "2 sentence summary",
  "topics": [{"topic": "short topic", "signal": "like" | "dislike" | "neutral"}]
}
