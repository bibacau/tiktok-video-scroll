Write the script for an ORIGINAL short vertical TikTok video.

## Instructions from the user
{{instructions}}

## The idea
{{idea}}

## Research that inspired it (don't copy; make something new)
{{research}}

Language: {{language}} (write voiceover, on-screen text, caption and hashtags in this language)
Tone: {{tone}} · Audience: {{audience}}
Target length: about {{length}} seconds → about {{scenes}} scenes of ~{{scene_seconds}}s each.
Hook style for the first scene: {{hook_style}}
Structure: {{structure}}
Call to action (last scene): {{cta}}
{{voice}}

Never use these words: {{banned_words}}
Never touch these topics: {{banned_topics}}
Do not impersonate or name real private people; no fake testimonials; no medical/financial promises.

For each scene:
- "voiceover": what is spoken (natural, short sentences, ~2.5 words per second)
- "on_screen": a very short headline shown on screen (max 6 words)
- "keywords": 2-4 ENGLISH words to search stock footage (e.g. "nasi lemak plate")
- "image_prompt": an ENGLISH description of a picture for this scene (no real people's names)

Caption rules: {{caption_rules}}
Hashtags: {{hashtag_count}} relevant hashtags, without #.

Reply with ONLY a JSON object:
{
  "title": "...", "hook": "...",
  "scenes": [{"voiceover": "...", "on_screen": "...", "keywords": "...", "image_prompt": "..."}],
  "caption": "...", "hashtags": ["...", "..."]
}
