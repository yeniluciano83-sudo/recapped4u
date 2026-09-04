const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
// ffmpeg-static's Linux binary (the CI runner's platform) is missing the
// drawtext filter despite claiming --enable-libfreetype -- a known quirk of
// that specific static build, confirmed live (Roast Reel rendering, which
// depends on drawtext to caption each photo, failed with "No such filter:
// 'drawtext'" every time). FFMPEG_PATH lets CI point at a real system
// ffmpeg (installed via apt, which does include drawtext) instead; local
// dev without it set keeps using the bundled binary, which has drawtext
// fine on Windows.
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || require("ffmpeg-static"));

const SECONDS_PER_SLOT = 4; // duration for plain photo and video-clip slots
const ROAST_SLOT_SECONDS = 10; // roast-captioned photo slots get more time -- 4s, then 7s, still had the photo changing before a viewer finished reading a longer line (confirmed from a real delivered keepsake video); on-screen text needs time to be noticed, read, and land the photo, not just prose-reading time
const TRANSITION_SECONDS = 0.6; // default when a caller doesn't pass styleConfig.transitionSeconds -- see assembleSlideshow
const FONT_PATH = path.join(__dirname, "fonts", "Oswald-Bold.ttf");

// A single ffmpeg process building one -filter_complex for every slot at
// once (scale/crop/blur/zoompan/drawtext per photo, all chained through
// xfade) has a memory footprint that scales with slot count -- confirmed
// live: an 80-photo Luxe booking (82 slots incl. intro/outro cards) crashed
// with "Cannot allocate memory" inside gblur on a machine with only ~1.4GB
// free RAM. Above this many slots, assembleSlideshow renders in bounded
// groups (each its own bounded ffmpeg process, run sequentially so only one
// is ever alive at a time) and merges the results -- see
// renderChunkedSlideshow. This bounds memory independent of total booking
// size (500 photos is just more sequential chunks than 80, not a bigger
// per-process footprint) -- but only if each individual chunk render is
// itself reliably safe. Confirmed live that 10 wasn't: a chunk this size
// (still at 3840x2160 with the same gblur/zoompan/drawtext chain per photo)
// OOM'd inside libx264 ("Failed to allocate packet", "Cannot allocate
// memory") on this same memory-constrained dev machine. Dropped to 5 for
// real headroom rather than tuning right up to the observed edge.
const MAX_SLOTS_PER_CHUNK = 5;

// Landscape defaults, used whenever a caller's styleConfig doesn't override
// outputWidth/outputHeight (see assembleSlideshow) -- the full video. Social
// cuts pass their own vertical dimensions instead (SOCIAL_CUT_OUTPUT in
// scripts/auto-recap.js).
const OUTPUT_WIDTH = 3840;
const OUTPUT_HEIGHT = 2160;

// ffmpeg's filtergraph syntax treats : as significant in an unquoted filter
// option value, which collides with a Windows drive letter (C:). Backslash
// -escaping the colon and single-quoting the value both misparse in this
// ffmpeg build once a fontfile/textfile pair are combined -- confirmed via
// direct CLI testing, not just in this pipeline's own code. The reliable
// fix is to sidestep the drive letter entirely: fluent-ffmpeg spawns ffmpeg
// with the same cwd as this Node process, so a path relative to that cwd
// never contains a colon in the first place.
function toFilterPath(p) {
  return path.relative(process.cwd(), p).replace(/\\/g, "/");
}

// drawtext doesn't auto-wrap -- break long roast lines onto multiple lines
// at word boundaries so they stay legible instead of overflowing the frame.
function wrapText(text, maxCharsPerLine = 42) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

// wrapText's default (42 chars/line) was tuned against the landscape
// frame's width-to-fontsize ratio and stays exactly as-is there. A
// vertical frame is a different story: fontsize scales with outputHeight
// (textScale = outputHeight / 1080), but a portrait frame's actual
// available width is much narrower than a landscape one at the same
// height -- 42 chars at the fontsize a 1920-tall vertical frame produces
// would run well past a 1080px-wide frame's edges. 0.86 leaves ~7% margin
// each side; 0.55 is an approximate average-character-width-to-fontsize
// ratio for Oswald Bold, a moderately condensed bold face.
function maxCharsForWidth(fontSize, frameWidth) {
  return Math.max(12, Math.floor((frameWidth * 0.86) / (fontSize * 0.55)));
}

// Renders one bounded range of slots (a full video's worth, when called
// directly by assembleSlideshow for a booking under MAX_SLOTS_PER_CHUNK, or
// one group of a larger booking's chunked render) as a single ffmpeg
// process with one -filter_complex. This is the entirety of what
// assembleSlideshow used to do inline before chunking existed -- the
// filter-chain math itself (scale/crop/blur/zoompan/drawtext per photo,
// tpad/trim per clip, the xfade offset accumulation) is unchanged.
//
// globalOffset is the slot index (within the caller's full, unsliced
// imagePaths/clipPaths) that this range's local index 0 corresponds to --
// needed because temp filenames and heroZoomIndex (which callers define
// against the full imagePaths array) must stay meaningful even though this
// range's own ffmpeg inputs are necessarily numbered from 0 (ffmpeg has no
// concept of a "global" index across separate processes). For a
// single-chunk render (the common case, unchanged from before chunking),
// globalOffset is just 0.
//
// includeAudio/includeProgressBar gate work that a chunked render defers to
// the final merge pass (renderChunkedSlideshow) -- both only make sense
// once the full video exists as one stream, not per-chunk.
function renderSlotRange(imagePaths, clipPaths, roastLines, overlayLines, outputPath, opts) {
  const { baseSlotSeconds, styleConfig, globalOffset, includeAudio, musicPath, includeProgressBar } = opts;

  const {
    transitionType = "fade",
    transitionSeconds = TRANSITION_SECONDS,
    grain = false,
    // Index into the CALLER's full imagePaths (not this range's local
    // slice, and not the global slot numbering that also includes
    // clipPaths) that gets an animated punch-in zoom instead of the static
    // frame every other photo slot renders -- a one-time "hook" moment
    // rather than a change to the baseline per-photo treatment. null means
    // no hero slot, i.e. today's behavior unchanged. See the photoFilters
    // loop below for why this is safe to animate (centered, unlike the
    // top-left-anchored zoom this codebase deliberately avoids elsewhere)
    // while every other slot stays static.
    heroZoomIndex = null,
    // Gives EVERY photo slot (not just one hero moment) the same kind of
    // centered zoompan animation, at a gentler target -- a continuous slow
    // "Ken Burns" drift instead of static frames throughout. Opt-in (false
    // = today's static behavior, unchanged) and only ever passed for the
    // full video (see scripts/auto-recap.js) -- social cuts keep their
    // hero-only treatment so every other slot stays a quick, static beat.
    // If a slot is somehow both the hero index and kenBurns is on, the
    // hero's punchier target wins (checked first in the photoFilters loop
    // below) -- not a real case today since no caller sets both, but kept
    // well-defined rather than left to depend on branch order by accident.
    kenBurns = false,
    // Landscape by default (the full video); social cuts pass 1080x1920
    // (see SOCIAL_CUT_OUTPUT in scripts/auto-recap.js) for native Reels/
    // TikTok/Shorts framing. Everything below -- scale/crop/pad/zoompan,
    // and every drawtext font size/position -- is computed from these
    // (and the derived textScale, below) rather than a fixed constant, so
    // this is the only thing that changes between the two.
    outputWidth = OUTPUT_WIDTH,
    outputHeight = OUTPUT_HEIGHT,
    // How a photo that doesn't match the frame's aspect ratio fills the
    // rest of the frame. "blur" (default) uses a scaled-up, cropped,
    // heavily blurred+dimmed copy of the same photo as its own backdrop.
    // "black" uses plain letterbox/pillarbox bars instead -- passed by the
    // full video (see scripts/auto-recap.js), where the blurred backdrop
    // was unwanted; it also skips the split + second full-res scale + the
    // gblur, which is by far the most expensive filter in this chain.
    photoBackground = "blur",
  } = styleConfig;
  const textScale = outputHeight / 1080;
  // Reels/TikTok/Shorts overlay their own UI (caption, username, the
  // like/comment/share stack) across roughly the bottom fifth of a
  // vertical video when it's actually being watched in-app -- bottom-
  // anchored text needs real headroom above that, not just enough to
  // clear the frame edge. Landscape has no such platform chrome to avoid
  // (downloaded, watched on a TV/laptop, emailed), so its margin stays
  // exactly what it's always been.
  const isVertical = outputHeight > outputWidth;
  return new Promise((resolve, reject) => {
    clipPaths = clipPaths || [];
    if ((!imagePaths || imagePaths.length === 0) && clipPaths.length === 0) {
      return reject(new Error("No images or video clips provided for slideshow"));
    }

    const command = ffmpeg();
    const slotCount = imagePaths.length + clipPaths.length;
    const slotDurations = [
      ...imagePaths.map((_, i) => (roastLines && roastLines[i] ? ROAST_SLOT_SECONDS : baseSlotSeconds)),
      ...clipPaths.map(() => baseSlotSeconds),
    ];

    // Each image becomes a short clip with a slow zoom (Ken Burns effect).
    // Loop the input indefinitely rather than capping it with an input -t --
    // zoompan doesn't stop emitting frames on its own when fed a continuously
    // looped image, so the actual per-clip duration is enforced below with an
    // explicit trim on the filtered output instead.
    imagePaths.forEach((imgPath) => {
      command.input(imgPath).inputOptions(["-loop", "1"]);
    });
    // Video clips already have their own timeline -- no -loop needed.
    clipPaths.forEach((clipPath) => {
      command.input(clipPath);
    });

    // Build a filter graph: zoom each image (or pad/trim each video clip),
    // trim/pad it to its exact duration, optionally burn on that photo's
    // Roast Reel line, then crossfade-concat every slot together
    const outputDir = path.dirname(outputPath);
    const fontPath = toFilterPath(FONT_PATH);

    const photoFilters = imagePaths.map((_, i) => {
      const globalIndex = globalOffset + i;
      const duration = slotDurations[i];
      // Event photos are usually portrait, so covering the frame by
      // cropping to fill would cut off content -- no crop (fixed or biased)
      // can guarantee the whole original photo stays visible. Fit the whole
      // image inside the frame instead (pillarboxed/letterboxed as needed)
      // so nothing from the original is ever cut off, and fill the rest of
      // the frame per photoBackground:
      //
      //   "blur"  -- the same photo doubles as its own background: scaled
      //              up to cover the frame, cropped, heavily blurred+dimmed,
      //              with the untouched foreground composited on top. Works
      //              unconditionally, including for a photo that already
      //              matches the frame aspect (the foreground then covers
      //              the frame completely and the background never shows).
      //   "black" -- plain letterbox/pillarbox bars. Cheaper (no split, no
      //              second full-res scale, no gblur) and what the full
      //              video uses.
      let chain =
        photoBackground === "black"
          ? `[${i}:v]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
            `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black`
          : `[${i}:v]split=2[bg${i}src][fg${i}src];` +
            `[bg${i}src]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,` +
            `crop=${outputWidth}:${outputHeight},gblur=sigma=25,eq=brightness=-0.12[bg${i}];` +
            `[fg${i}src]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease[fg${i}];` +
            `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2`;

      // Retro's "warm film grain" -- applied after the pad (so the grain
      // covers the letterbox bars too, like a real scanned frame) and
      // before zoompan, a standard ffmpeg built-in (unlike drawtext, which
      // needed the FFMPEG_PATH CI workaround above for a libfreetype quirk).
      // Real per-pixel noise is inherently expensive for H.264 to encode
      // (it has no spatial/temporal redundancy to exploit) -- confirmed via
      // live testing that lowering this value, or switching to a
      // temporally-static "patterned" noise flag, barely moves file size at
      // this crf; a Retro video really is meaningfully larger than the
      // other styles as a direct cost of the effect, not a tunable mistake.
      if (grain) chain += `,noise=alls=8:allf=t+u`;

      const frameCount = Math.round(duration * 25);
      // heroZoomIndex's punch-in (1.18, a deliberately snappy "hook") takes
      // priority over kenBurns' gentler continuous drift (1.1) if a slot
      // somehow qualified for both -- see the kenBurns comment above for
      // why that's not actually a case any caller hits today. Compared
      // against globalIndex, not i -- heroZoomIndex is defined against the
      // caller's full imagePaths, not this range's local slice.
      const zoomTarget = globalIndex === heroZoomIndex ? 1.18 : kenBurns ? 1.1 : null;
      if (zoomTarget !== null) {
        // A centered zoom, unlike the top-left-anchored one the comment
        // above rules out -- and centering is safe here because zoompan
        // runs on the already-composed full-frame result above (blurred
        // backdrop, or the photo padded with bars), not the raw photo:
        // with zoom always >= 1 it only ever crops further *inward* on a
        // frame that's already fully painted, so it can never reveal empty
        // space, in either photoBackground mode. It converges on the
        // centered photo, which reads as "push in on the subject" rather
        // than an arbitrary crop (and in "black" mode the bars simply
        // shrink out of view as it pushes in). zoom's recurrence
        // (min(zoom+step, target)) is the standard zoompan Ken Burns
        // idiom -- each output frame nudges toward target by one step
        // from the previous frame's zoom level, reset to 1 on frame 0.
        const zoomStep = frameCount > 0 ? (zoomTarget - 1) / frameCount : 0;
        // Oversample before zoompan. zoompan recomputes its crop-window
        // origin (x/y) every frame and rounds it to a whole pixel, so a
        // slow zoom makes fine detail visibly vibrate ~1px frame-to-frame
        // -- very obvious on a crisp photo (it used to be masked by the
        // blurred moving background). Feeding zoompan a frame scaled up 2x
        // means that 1px snap is half an output pixel, below the threshold
        // of visible jitter, and the final downscale in zoompan's own
        // s=WxH mops up the rest. 2x a 4K frame is heavy, but rendering is
        // chunked (MAX_SLOTS_PER_CHUNK) so only a few are ever in flight.
        chain +=
          `,scale=${outputWidth * 2}:${outputHeight * 2}:flags=lanczos` +
          `,zoompan=z='if(eq(on,0),1,min(zoom+${zoomStep.toFixed(6)},${zoomTarget}))':` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${outputWidth}x${outputHeight}:fps=25,` +
          `trim=duration=${duration},setpts=PTS-STARTPTS`;
      } else {
        // No zoom: just hold the still at 25fps for the slot's duration.
        // Not via zoompan (even zoompan=z=1 runs its own scaler and can add
        // a faint shimmer) -- the chain above already produced a WxH frame.
        chain += `,fps=25,trim=duration=${duration},setpts=PTS-STARTPTS`;
      }

      if (roastLines && roastLines[i]) {
        const roastFontSize = Math.round(52 * textScale);
        const textFilePath = path.join(outputDir, `roast-line-${globalIndex}.txt`);
        fs.writeFileSync(textFilePath, wrapText(roastLines[i], isVertical ? maxCharsForWidth(roastFontSize, outputWidth) : undefined));
        // Bottom margin: a real safe-zone allowance in vertical mode
        // (roughly the platform-UI-covered fraction of the screen), the
        // original small fixed offset otherwise -- see the isVertical
        // comment above.
        const roastBottomMargin = isVertical ? Math.round(outputHeight * 0.18) : Math.round(70 * textScale);
        chain +=
          `,drawtext=fontfile=${fontPath}:textfile=${toFilterPath(textFilePath)}:reload=0:` +
          `fontcolor=white:fontsize=${roastFontSize}:line_spacing=${Math.round(10 * textScale)}:x=(w-text_w)/2:y=h-text_h-${roastBottomMargin}:` +
          `box=1:boxcolor=black@0.55:boxborderw=${Math.round(24 * textScale)}`;
      }

      const overlay = overlayLines && overlayLines[i];
      if (overlay) {
        const overlayFontSize = Math.round(46 * textScale);
        const overlayFilePath = path.join(outputDir, `overlay-line-${globalIndex}.txt`);
        fs.writeFileSync(overlayFilePath, wrapText(overlay.text, isVertical ? maxCharsForWidth(overlayFontSize, outputWidth) : undefined));
        const xy = overlay.position === "top-left"
          ? `x=${Math.round(60 * textScale)}:y=${Math.round(70 * textScale)}`
          : overlay.position === "center"
          ? `x=(w-text_w)/2:y=(h-text_h)/2` // outro/title cards -- centered in an otherwise-empty frame, not a caption competing with photo content
          : `x=(w-text_w)/2:y=${Math.round(70 * textScale)}`; // "top-center" default
        chain +=
          `,drawtext=fontfile=${fontPath}:textfile=${toFilterPath(overlayFilePath)}:reload=0:` +
          `fontcolor=${overlay.fontColor || "white"}:fontsize=${overlayFontSize}:line_spacing=${Math.round(8 * textScale)}:${xy}:` +
          `box=1:boxcolor=${overlay.boxColor || "black@0.6"}:boxborderw=${Math.round(20 * textScale)}`;
      }

      return chain + `[v${i}]`;
    });

    const clipFilters = clipPaths.map((_, j) => {
      const i = imagePaths.length + j; // continues the same local slot numbering
      const duration = slotDurations[i];
      // tpad always adds up to `duration` of cloned-last-frame padding
      // regardless of the clip's actual length, so the stream is guaranteed
      // to be at least that long by the time trim runs -- correct whether
      // the source clip is shorter or longer than its slot, with no need
      // to probe its actual duration first.
      return (
        `[${i}:v]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black,fps=25` +
        (grain ? `,noise=alls=8:allf=t+u` : "") +
        `,tpad=stop_mode=clone:stop_duration=${duration},` +
        `trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`
      );
    });

    const zoomFilters = [...photoFilters, ...clipFilters].join(";");

    // xfade's offset is the point in the accumulated stream's own timeline
    // where the next fade begins -- with non-uniform slot durations that's
    // a running total of every preceding slot's duration, minus one
    // transitionSeconds per prior transition (each fade overlaps two
    // slots rather than playing them fully back-to-back). segmentStarts
    // captures each slot's start time in this range's own local timeline,
    // reused below to time the vertical-only progress bar when this range
    // IS the whole video (includeProgressBar); a chunked render defers the
    // bar to the merge pass, computed there from the full booking's global
    // timeline instead.
    let concatChain = "";
    let lastLabel = "v0";
    let cumulative = slotDurations[0];
    const segmentStarts = [0];
    for (let i = 1; i < slotCount; i++) {
      const outLabel = `vx${i}`;
      const offset = cumulative - i * transitionSeconds;
      segmentStarts.push(offset);
      concatChain += `[${lastLabel}][v${i}]xfade=transition=${transitionType}:duration=${transitionSeconds}:offset=${offset}[${outLabel}];`;
      lastLabel = outLabel;
      cumulative += slotDurations[i];
    }
    const totalDuration = cumulative - Math.max(0, slotCount - 1) * transitionSeconds;

    // Story-style segmented progress bar (one segment per slot, filling in
    // as it plays) -- a native Reels/TikTok/Shorts UI convention, so it
    // only renders for vertical social cuts, gated by the same isVertical
    // flag as the caption safe-zone margin above. Landscape (the full
    // video, watched outside any social app) stays exactly as it's always
    // rendered. Skipped for a single-slot video too -- nothing to show
    // progress through.
    if (includeProgressBar && isVertical && slotCount > 1) {
      const barMarginX = Math.round(outputWidth * 0.04);
      const barTop = Math.round(outputHeight * 0.025);
      const barHeight = Math.max(3, Math.round(outputHeight * 0.005));
      const gapWidth = Math.max(2, Math.round(outputWidth * 0.008));
      const segWidth = (outputWidth - 2 * barMarginX - gapWidth * (slotCount - 1)) / slotCount;

      const segments = [];
      for (let i = 0; i < slotCount; i++) {
        const segX = Math.round(barMarginX + i * (segWidth + gapWidth));
        const segW = Math.round(segWidth);
        const segStart = segmentStarts[i];
        const segEnd = i === slotCount - 1 ? totalDuration : segmentStarts[i + 1];
        const segDuration = Math.max(0.1, segEnd - segStart);
        // Dim track, always visible, then a bright fill whose width grows
        // from 0 to segW as t sweeps through this slot's own window and
        // stays capped at segW afterward (the min() clamps it once t
        // passes segEnd) -- no separate "already completed" filter needed.
        // The whole w= expression is single-quoted per ffmpeg's own
        // filtergraph escaping rules so its internal commas aren't
        // mistaken for the commas chaining these drawbox filters together.
        segments.push(`drawbox=x=${segX}:y=${barTop}:w=${segW}:h=${barHeight}:color=white@0.3:t=fill`);
        segments.push(
          `drawbox=x=${segX}:y=${barTop}:w='min(${segW},${segW}*max(0,(t-${segStart.toFixed(3)}))/${segDuration.toFixed(3)})':h=${barHeight}:color=white@0.95:t=fill`
        );
      }
      concatChain += `[${lastLabel}]${segments.join(",")}[vbar];`;
      lastLabel = "vbar";
    }

    const filterComplex = zoomFilters + (concatChain ? ";" + concatChain.slice(0, -1) : "");

    // Passed via -filter_complex_script (a file) rather than fluent-ffmpeg's
    // usual .complexFilter() (which puts the whole string on the command
    // line as a single -filter_complex argument) -- confirmed live: a large
    // booking's filter graph (80+ photo slots, each with its own
    // scale/crop/blur/zoompan/drawtext chain, all chained through xfade)
    // is long enough to exceed Windows' ~32K command-line length limit,
    // crashing spawn() with ENAMETOOLONG before ffmpeg even starts. Linux
    // (the CI runner) has a much higher ceiling but not an infinite one, so
    // this is the more broadly correct fix, not a Windows-only workaround.
    const filterComplexFile = path.join(outputDir, `filter-complex-${globalOffset}-${Date.now()}.txt`);
    fs.writeFileSync(filterComplexFile, filterComplex.replace(/^;/, ""));

    command
      .outputOptions(["-filter_complex_script", toFilterPath(filterComplexFile)])
      .outputOptions([
        "-map", `[${lastLabel}]`,
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        // "medium" (x264's default), not "slow" or "veryfast". "slow"/crf 16
        // is near-lossless but ~3x slower than "medium" and an 80-photo full
        // video alone couldn't finish the 75-minute CI job at it.
        // "veryfast" was fast enough but its weak motion search makes fine
        // detail "boil" frame-to-frame on the slow Ken Burns push-in -- very
        // visible on a crisp 4K photo. "medium" has proper ME + psy
        // optimizations that fix the boil, still ~2x faster than "slow", and
        // chunked rendering (MAX_SLOTS_PER_CHUNK) plus the resumable render
        // path keep even a 300-photo booking inside the job budget.
        "-preset", "medium",
        "-crf", "20",
        "-r", "25",
      ]);

    if (includeAudio && musicPath) {
      const musicInputIndex = slotCount;
      // -stream_loop -1 repeats the track indefinitely so it's never the
      // shorter stream -- -shortest then only ever trims the (now always
      // long-enough) music down to the video's real length, which is what
      // it was meant to do. Without looping, -shortest instead silently
      // trims the VIDEO down to a short fixed-length music track whenever
      // a booking's photo count makes the video longer than its style's
      // music file -- confirmed live: a real delivered video's outro card
      // (and part of the last photo) was cut off exactly at the music
      // track's own duration, to the hundredth of a second.
      command.input(musicPath).inputOptions(["-stream_loop", "-1"]);
      command.outputOptions(["-map", `${musicInputIndex}:a`, "-shortest", "-c:a", "aac", "-b:a", "192k"]);
    }

    command
      .output(outputPath)
      .on("stderr", (line) => console.error("FFMPEG STDERR:", line))
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

// The chunk plan for a booking: consecutive slot ranges of at most
// MAX_SLOTS_PER_CHUNK, over the combined image-then-clip slot list. Pure
// arithmetic, no rendering -- shared by the one-shot renderChunkedSlideshow
// below and the resumable renderFullVideoChunks, and unit-tested directly.
function planChunks(imageCount, clipCount) {
  const slotCount = imageCount + clipCount;
  const chunks = [];
  for (let start = 0; start < slotCount; start += MAX_SLOTS_PER_CHUNK) {
    const end = Math.min(start + MAX_SLOTS_PER_CHUNK, slotCount);
    chunks.push({
      start,
      end,
      imageStart: Math.min(start, imageCount),
      imageEnd: Math.min(end, imageCount),
      clipStart: Math.max(0, start - imageCount),
      clipEnd: Math.max(0, end - imageCount),
    });
  }
  return chunks;
}

// Renders one chunk of a plan (from planChunks) to chunkOutputPath as its
// own ffmpeg process -- no audio, no progress bar, those belong to the
// merge. globalOffset is the chunk's first slot index in the full video, so
// heroZoomIndex / roast-line / overlay temp filenames stay stable across
// the separate processes (see renderSlotRange's globalOffset comment).
function renderOneChunk(plan, chunkIdx, imagePaths, clipPaths, roastLines, overlayLines, chunkOutputPath, baseSlotSeconds, styleConfig) {
  const c = plan[chunkIdx];
  return renderSlotRange(
    imagePaths.slice(c.imageStart, c.imageEnd),
    clipPaths.slice(c.clipStart, c.clipEnd),
    roastLines ? roastLines.slice(c.start, c.imageEnd) : null,
    overlayLines ? overlayLines.slice(c.start, c.imageEnd) : null,
    chunkOutputPath,
    { baseSlotSeconds, styleConfig, globalOffset: c.start, includeAudio: false, musicPath: null, includeProgressBar: false }
  );
}

// Stitches already-rendered landscape chunk files into one video: ffmpeg's
// concat demuxer with -c:v copy (a hard cut at each boundary, effectively
// free -- see renderChunkedSlideshow's comment) plus the optional looped
// music track. Chunk files must all sit in the same directory as outputPath
// so the bare-filename concat list resolves (see that comment too). This is
// the merge for the full video (landscape); the vertical progress-bar merge
// stays inline in renderChunkedSlideshow, which is the only thing that
// needs it.
function mergeFullVideoChunks(chunkPaths, outputPath, musicPath) {
  const outputDir = path.dirname(outputPath);
  const concatListPath = path.join(outputDir, `concat-list-${Date.now()}.txt`);
  fs.writeFileSync(concatListPath, chunkPaths.map((p) => `file '${path.basename(p)}'`).join("\n"));

  const mergeCommand = ffmpeg();
  mergeCommand.input(concatListPath).inputOptions(["-f", "concat", "-safe", "0"]);
  if (musicPath) mergeCommand.input(musicPath).inputOptions(["-stream_loop", "-1"]);
  mergeCommand.outputOptions(["-map", "0:v", "-c:v", "copy"]);
  if (musicPath) mergeCommand.outputOptions(["-map", "1:a", "-shortest", "-c:a", "aac", "-b:a", "192k"]);

  return new Promise((resolve, reject) => {
    mergeCommand
      .output(outputPath)
      .on("stderr", (line) => console.error("FFMPEG STDERR:", line))
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

// Resumable half of a chunked full-video render: renders the chunks that
// aren't in doneChunks yet, in order, calling (and awaiting) onChunkRendered
// (chunkIdx, chunkPath) after each so the caller can persist that chunk
// before the next starts -- a process killed mid-run loses at most the one
// chunk in flight. Stops once budgetMs of wall time has elapsed (but always
// renders at least one chunk per call, so a too-small budget still makes
// progress). Returns { totalChunks, complete } -- complete:false means the
// caller should call again next run with the now-larger doneChunks. The
// merge (mergeFullVideoChunks) is a separate step the caller runs once
// complete is true. workDir must be where the caller wants chunk files and,
// later, the merge output.
async function renderFullVideoChunks(imagePaths, clipPaths, roastLines, overlayLines, workDir, opts) {
  const { baseSlotSeconds, styleConfig, doneChunks = new Set(), budgetMs = Infinity, onChunkRendered } = opts;
  const plan = planChunks(imagePaths.length, clipPaths.length);
  const deadline = Date.now() + budgetMs;
  let renderedThisRun = 0;

  for (let i = 0; i < plan.length; i++) {
    if (doneChunks.has(i)) continue;
    if (renderedThisRun > 0 && Date.now() >= deadline) {
      return { totalChunks: plan.length, complete: false };
    }
    const chunkPath = path.join(workDir, `chunk-${i}.mp4`);
    await renderOneChunk(plan, i, imagePaths, clipPaths, roastLines, overlayLines, chunkPath, baseSlotSeconds, styleConfig);
    renderedThisRun++;
    if (onChunkRendered) await onChunkRendered(i, chunkPath);
  }
  return { totalChunks: plan.length, complete: true };
}

// Large bookings (more slots than MAX_SLOTS_PER_CHUNK) don't fit in one
// ffmpeg process' memory budget -- see the constant's comment. Renders in
// bounded groups instead, strictly sequentially (one ffmpeg process alive
// at a time is what actually bounds memory, not just the group size), then
// merges the resulting chunk files via ffmpeg's concat demuxer with
// -c:v copy -- a hard cut at each chunk boundary rather than a crossfade
// there (crossfades still play normally between every other slot, within
// each chunk's own filtergraph, unchanged). This isn't a rare edge case --
// most real bookings run well past MAX_SLOTS_PER_CHUNK, so the merge needs
// to be cheap: stream-copying the (already-identically-encoded) chunk
// files together is close to instant, versus decoding and re-encoding the
// whole video's length a second time, which an earlier version of this
// function did (chained xfade across chunk files) purely to keep every
// transition seamless -- confirmed live that doubling total encode work
// that way is a real cost, not a theoretical one, once large bookings are
// the common case rather than the exception. A hard cut every ~10 photos
// was the trade accepted in exchange.
//
// One side effect of hard cuts: each chunk boundary no longer "loses" one
// transitionSeconds of crossfade overlap the way every other transition
// does, so the actual rendered duration runs numChunks-1 * transitionSeconds
// longer than the flat single-pass formula callers (scripts/auto-recap.js)
// solve slot pacing against -- a few seconds on a multi-minute video for a
// typical large booking, not worth threading a correction back through
// caller-side duration math for.
async function renderChunkedSlideshow(imagePaths, clipPaths, outputPath, musicPath, roastLines, baseSlotSeconds, styleConfig) {
  const {
    overlayLines = null,
    outputWidth = OUTPUT_WIDTH,
    outputHeight = OUTPUT_HEIGHT,
  } = styleConfig;
  const isVertical = outputHeight > outputWidth;
  const outputDir = path.dirname(outputPath);

  const slotCount = imagePaths.length + clipPaths.length;
  const slotDurations = [
    ...imagePaths.map((_, i) => (roastLines && roastLines[i] ? ROAST_SLOT_SECONDS : baseSlotSeconds)),
    ...clipPaths.map(() => baseSlotSeconds),
  ];

  const plan = planChunks(imagePaths.length, clipPaths.length);
  const chunkPaths = [];
  for (let i = 0; i < plan.length; i++) {
    // Awaited one at a time, not Promise.all'd -- parallel chunk renders
    // would each need their own share of the same limited memory budget
    // this whole mechanism exists to stay under. The chunk filename carries
    // the output's basename because renderChunkedSlideshow is called several
    // times into the same tmpDir (full cut, no-roast cut, each social cut)
    // and a bare chunk-N.mp4 would collide across them.
    const chunkOutputPath = path.join(outputDir, `chunk-${path.basename(outputPath, ".mp4")}-${i}.mp4`);
    await renderOneChunk(plan, i, imagePaths, clipPaths, roastLines, overlayLines, chunkOutputPath, baseSlotSeconds, styleConfig);
    chunkPaths.push(chunkOutputPath);
  }

  // Landscape full video: a plain stream-copy concat of the chunks (plus the
  // looped music) -- effectively free, no re-encode.
  if (!(isVertical && slotCount > 1)) {
    return mergeFullVideoChunks(chunkPaths, outputPath, musicPath);
  }

  // Vertical + chunked (a social cut past MAX_SLOTS_PER_CHUNK): re-encode the
  // merged length once to burn in the story-style progress bar. Segment
  // timing uses the flat single-pass formula, so on a hard-cut merge the
  // last segment(s) land slightly short of the true (now longer) end -- a
  // harmless drift for a progress bar. Same bare-filename concat list as
  // mergeFullVideoChunks (see its comment).
  const concatListPath = path.join(outputDir, `concat-list-${Date.now()}.txt`);
  fs.writeFileSync(concatListPath, chunkPaths.map((p) => `file '${path.basename(p)}'`).join("\n"));

  const mergeCommand = ffmpeg();
  mergeCommand.input(concatListPath).inputOptions(["-f", "concat", "-safe", "0"]);
  // -stream_loop -1 -- see the identical comment in renderSlotRange's own
  // audio-mapping block for why a looped music input is required for
  // -shortest below to behave correctly.
  if (musicPath) mergeCommand.input(musicPath).inputOptions(["-stream_loop", "-1"]);

  {
    let cumulative = slotDurations[0];
    const segmentStarts = [0];
    const transitionSeconds = styleConfig.transitionSeconds ?? TRANSITION_SECONDS;
    for (let i = 1; i < slotCount; i++) {
      segmentStarts.push(cumulative - i * transitionSeconds);
      cumulative += slotDurations[i];
    }
    const totalDuration = cumulative - Math.max(0, slotCount - 1) * transitionSeconds;

    const barMarginX = Math.round(outputWidth * 0.04);
    const barTop = Math.round(outputHeight * 0.025);
    const barHeight = Math.max(3, Math.round(outputHeight * 0.005));
    const gapWidth = Math.max(2, Math.round(outputWidth * 0.008));
    const segWidth = (outputWidth - 2 * barMarginX - gapWidth * (slotCount - 1)) / slotCount;

    const segments = [];
    for (let i = 0; i < slotCount; i++) {
      const segX = Math.round(barMarginX + i * (segWidth + gapWidth));
      const segW = Math.round(segWidth);
      const segStart = segmentStarts[i];
      const segEnd = i === slotCount - 1 ? totalDuration : segmentStarts[i + 1];
      const segDuration = Math.max(0.1, segEnd - segStart);
      segments.push(`drawbox=x=${segX}:y=${barTop}:w=${segW}:h=${barHeight}:color=white@0.3:t=fill`);
      segments.push(
        `drawbox=x=${segX}:y=${barTop}:w='min(${segW},${segW}*max(0,(t-${segStart.toFixed(3)}))/${segDuration.toFixed(3)})':h=${barHeight}:color=white@0.95:t=fill`
      );
    }
    const mergeFilterFile = path.join(outputDir, `filter-merge-${Date.now()}.txt`);
    fs.writeFileSync(mergeFilterFile, `[0:v]${segments.join(",")}[vbar]`);

    mergeCommand
      .outputOptions(["-filter_complex_script", toFilterPath(mergeFilterFile)])
      // Same preset/crf as renderSlotRange -- see the comment there. This
      // branch (vertical + chunked) re-encodes the full merged length to
      // burn in the progress bar.
      .outputOptions(["-map", "[vbar]", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "25"]);
  }

  if (musicPath) {
    mergeCommand.outputOptions(["-map", "1:a", "-shortest", "-c:a", "aac", "-b:a", "192k"]);
  }

  return new Promise((resolve, reject) => {
    mergeCommand
      .output(outputPath)
      .on("stderr", (line) => console.error("FFMPEG STDERR:", line))
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

// clipPaths are appended after imagePaths in the final sequence -- guest
// video clips, roast-free (roastLines only ever applies to the photo
// slots), each padded/trimmed to baseSlotSeconds. Roast-captioned photo
// slots run longer (ROAST_SLOT_SECONDS) so there's time to actually read
// the line -- slot durations aren't uniform, so the crossfade offsets
// are computed from a running cumulative sum rather than a fixed
// multiple of one constant.
//
// baseSlotSeconds overrides the default per-slot duration (used for the
// social cut's tighter pacing, computed by the caller to hit a target
// total length) -- has no effect on roast-captioned slots, which always
// use ROAST_SLOT_SECONDS regardless.
//
// styleConfig carries the per-editing-style treatment (see
// STYLE_VIDEO_CONFIG in scripts/auto-recap.js, the only caller that
// populates this): transitionType/transitionSeconds override the xfade
// used between every slot (default "fade"/0.6s, today's original
// behavior); grain overlays film noise on every photo/clip; overlayLines
// is an array parallel to imagePaths, each entry either null or
// { text, position: "top-center" | "top-left" | "center", fontColor, boxColor } --
// rendered via the same wrapText/drawtext machinery as roastLines, as an
// independent pass so a photo can carry both without colliding (roast
// lines always sit at the bottom; overlays always sit at the top).
//
// Renders directly (one ffmpeg process, today's original behavior) when the
// total slot count fits under MAX_SLOTS_PER_CHUNK, or via
// renderChunkedSlideshow (bounded groups, merged) above that -- see its
// comment for why. A booking under the threshold is completely unaffected
// by chunking: same function call, same arguments, same output.
function assembleSlideshow(imagePaths, clipPaths, outputPath, musicPath, roastLines, baseSlotSeconds = SECONDS_PER_SLOT, styleConfig = {}) {
  clipPaths = clipPaths || [];
  const slotCount = imagePaths.length + clipPaths.length;

  if (slotCount <= MAX_SLOTS_PER_CHUNK) {
    return renderSlotRange(imagePaths, clipPaths, roastLines, styleConfig.overlayLines || null, outputPath, {
      baseSlotSeconds,
      styleConfig,
      globalOffset: 0,
      includeAudio: true,
      musicPath,
      includeProgressBar: true,
    });
  }

  return renderChunkedSlideshow(imagePaths, clipPaths, outputPath, musicPath, roastLines, baseSlotSeconds, styleConfig);
}

// Grabs a single frame from a finished video as a JPEG poster -- the
// gallery page's video "player" is a static box with a play button (see
// app/gallery/[bookingId]/page.jsx) that looks like an empty placeholder
// without one. Seeks partway in rather than frame 0: slot 1 is still
// mid-crossfade-in from black at the very start of the timeline.
function extractPosterFrame(videoPath, outputPath, atSeconds = 1.5) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(atSeconds)
      .frames(1)
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

module.exports = {
  assembleSlideshow,
  extractPosterFrame,
  // Resumable chunked full-video rendering -- see scripts/auto-recap.js's
  // driveRender, which persists each chunk to R2 between calls so a large
  // 4K render can span several scheduled jobs.
  planChunks,
  renderFullVideoChunks,
  mergeFullVideoChunks,
  MAX_SLOTS_PER_CHUNK,
  ROAST_SLOT_SECONDS,
  SECONDS_PER_SLOT,
};
