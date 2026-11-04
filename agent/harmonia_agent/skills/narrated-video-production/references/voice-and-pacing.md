# Voice and pacing for synthetic narration

Meta MMS-TTS reads exactly what it is given, in one neutral voice, with no
SSML. Pacing comes from the words alone.

- Short sentences create pauses. A full stop is a breath; a comma is half of one.
- Front-load the subject: "Your best post is buried in a call recording." not
  "Buried in a call recording is your best post."
- Avoid homographs and jargon the voice may misread (read/read, lead/lead,
  "SaaS", "B2B"). Write "software company", "business buyers".
- Numbers: write them as words. Dates: "March fourth". Money: "two hundred dollars".
- Brand and product names: write them as they are pronounced. If unsure,
  keep them out of narration and put them in the caption.
- Keep total narration under 120 words; the renderer rejects scenes longer than
  60 words or videos longer than 90 seconds.
