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
const ROAST_SLOT_SECONDS = 7; // roast-captioned photo slots get more time -- 4s wasn't enough to read a line and register the photo before the next one appeared
const TRANSITION_SECONDS = 0.6; // default when a caller doesn't pass styleConfig.transitionSeconds -- see assembleSlideshow
const FONT_PATH = path.join(__dirname, "fonts", "Oswald-Bold.ttf");

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

// clipPaths are appended after imagePaths in the final sequence -- guest
// video clips, roast-free (roastLines only ever applies to the photo
// slots), each padded/trimmed to baseSlotSeconds. Roast-captioned photo
// slots run longer (ROAST_SLOT_SECONDS) so there's time to actually read
// the line -- slot durations aren't uniform, so the crossfade offsets
// below are computed from a running cumulative sum rather than a fixed
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
function assembleSlideshow(imagePaths, clipPaths, outputPath, musicPath, roastLines, baseSlotSeconds = SECONDS_PER_SLOT, styleConfig = {}) {
  const {
    transitionType = "fade",
    transitionSeconds = TRANSITION_SECONDS,
    grain = false,
    overlayLines = null,
    // Index into imagePaths (not the global slot numbering that also
    // includes clipPaths) that gets an animated punch-in zoom instead of
    // the static frame every other photo slot renders -- a one-time
    // "hook" moment rather than a change to the baseline per-photo
    // treatment. null means no hero slot, i.e. today's behavior
    // unchanged. See the photoFilters loop below for why this is safe to
    // animate (centered, unlike the top-left-anchored zoom this codebase
    // deliberately avoids elsewhere) while every other slot stays static.
    heroZoomIndex = null,
    // Landscape by default (the full video); social cuts pass 1080x1920
    // (see SOCIAL_CUT_OUTPUT in scripts/auto-recap.js) for native Reels/
    // TikTok/Shorts framing. Everything below -- scale/crop/pad/zoompan,
    // and every drawtext font size/position -- is computed from these
    // (and the derived textScale, below) rather than a fixed constant, so
    // this is the only thing that changes between the two.
    outputWidth = OUTPUT_WIDTH,
    outputHeight = OUTPUT_HEIGHT,
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
      const duration = slotDurations[i];
      // Event photos are usually portrait, so covering a 1920x1080 frame
      // means cropping content to fill it -- no crop (fixed or biased) can
      // guarantee the whole original photo stays visible. Fit the whole
      // image inside the frame instead (pillarboxed/letterboxed as
      // needed) so nothing from the original is ever cut off. The zoom
      // animation is disabled for the same reason: zoompan here isn't
      // centered (x/y default to 0, anchoring the crop to the top-left),
      // so any zoom > 1 would progressively crop toward the bottom-right
      // over the clip -- a static frame is the only way to keep 100% of
      // the photo visible for the full duration.
      //
      // Rather than plain black letterbox bars, the same photo doubles as
      // its own background: scaled up to cover the frame, cropped, and
      // heavily blurred+dimmed, with the untouched foreground composited
      // on top. This works unconditionally, including for a photo that
      // already matches the frame's aspect ratio -- the foreground then
      // covers the frame completely, so the background never shows.
      let chain =
        `[${i}:v]split=2[bg${i}src][fg${i}src];` +
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
      if (i === heroZoomIndex) {
        // A centered punch-in, unlike the top-left-anchored zoom the
        // comment above rules out -- and centering is actually safe here
        // specifically because zoompan runs on the bg+fg composite above,
        // not the original photo directly: that composite already covers
        // the entire frame edge-to-edge (blurred background, no
        // letterbox), so zooming toward its center can never reveal empty
        // space, and it converges on the foreground photo (already
        // centered by the overlay above it), which reads as "push in on
        // the subject" rather than an arbitrary crop. zoom's recurrence
        // (min(zoom+step, target)) is the standard zoompan Ken Burns
        // idiom -- each output frame nudges toward target by one step
        // from the previous frame's zoom level, reset to 1 on frame 0.
        const heroZoomTarget = 1.18;
        const heroZoomStep = frameCount > 0 ? (heroZoomTarget - 1) / frameCount : 0;
        chain +=
          `,zoompan=z='if(eq(on,0),1,min(zoom+${heroZoomStep.toFixed(6)},${heroZoomTarget}))':` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${outputWidth}x${outputHeight}:fps=25,` +
          `trim=duration=${duration},setpts=PTS-STARTPTS`;
      } else {
        chain +=
          `,zoompan=z=1:d=${frameCount}:s=${outputWidth}x${outputHeight}:fps=25,` +
          `trim=duration=${duration},setpts=PTS-STARTPTS`;
      }

      if (roastLines && roastLines[i]) {
        const roastFontSize = Math.round(52 * textScale);
        const textFilePath = path.join(outputDir, `roast-line-${i}.txt`);
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
        const overlayFilePath = path.join(outputDir, `overlay-line-${i}.txt`);
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
      const i = imagePaths.length + j; // continues the same global slot numbering
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
    // captures each slot's start time in this same final timeline, reused
    // below to time the vertical-only progress bar.
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
    if (isVertical && slotCount > 1) {
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

    command
      .complexFilter(filterComplex.replace(/^;/, ""))
      .outputOptions([
        "-map", `[${lastLabel}]`,
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "16",
        "-r", "25",
      ]);

    if (musicPath) {
      const musicInputIndex = slotCount;
      command.input(musicPath).outputOptions(["-map", `${musicInputIndex}:a`, "-shortest", "-c:a", "aac", "-b:a", "192k"]);
    }

    command
      .output(outputPath)
      .on("stderr", (line) => console.error("FFMPEG STDERR:", line))
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
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

module.exports = { assembleSlideshow, extractPosterFrame };