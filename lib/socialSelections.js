// Extracted from scripts/auto-recap.js so this selection logic can be unit
// tested without needing to mock R2, ffmpeg, or the Claude analysis call
// that produces `analyzed` in the real pipeline.

const MAX_SOCIAL_PHOTOS = 15;

// Host-starred "must include" photos always make the FIRST social cut,
// regardless of their AI quality score. That cut is filled out with the
// highest-scoring remaining photos up to MAX_SOCIAL_PHOTOS; each additional
// cut (Luxe only) takes the next-best batch after that, so multiple cuts
// are genuinely different content rather than re-edits of the same shots.
// Returns an array of selections (empty selections are omitted -- a small
// event's photo pool can easily run out before 5 cuts' worth exist).
function buildSocialSelections(analyzed, count) {
  const ranked = [...analyzed].sort(
    (a, b) => (b.analysis.emotional_strength + b.analysis.technical_quality) - (a.analysis.emotional_strength + a.analysis.technical_quality)
  );
  const mustInclude = ranked.filter((a) => a.upload.must_include_social).slice(0, MAX_SOCIAL_PHOTOS);
  const usedIds = new Set(mustInclude.map((a) => a.upload.id));
  const remaining = ranked.filter((a) => !usedIds.has(a.upload.id));

  const selections = [];
  const firstFillCount = MAX_SOCIAL_PHOTOS - mustInclude.length;
  const firstCut = [...mustInclude, ...remaining.slice(0, firstFillCount)];
  if (firstCut.length > 0) selections.push(firstCut);
  firstCut.slice(mustInclude.length).forEach((a) => usedIds.add(a.upload.id));

  let cursor = firstFillCount;
  for (let i = 1; i < count; i++) {
    const nextCut = remaining.slice(cursor, cursor + MAX_SOCIAL_PHOTOS);
    if (nextCut.length === 0) break;
    selections.push(nextCut);
    cursor += MAX_SOCIAL_PHOTOS;
  }
  return selections;
}

module.exports = { buildSocialSelections, MAX_SOCIAL_PHOTOS };
