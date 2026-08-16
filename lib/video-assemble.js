const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
ffmpeg.setFfmpegPath(ffmpegPath);

const SECONDS_PER_SLOT = 4; // duration for plain photo and video-clip slots
const ROAST_SLOT_SECONDS = 7; // roast-captioned photo slots get more time -- 4s wasn't enough to read a line and register the photo before the next one appeared
const TRANSITION_SECONDS = 0.6;
const FONT_PATH = path.join(__dirname, "fonts", "Oswald-Bold.ttf");

const OUTPUT_WIDTH = 3840;
const OUTPUT_HEIGHT = 2160;
// drawtext sizes are in absolute pixels, not relative to frame size -- scale
// them with the output resolution so captions stay the same proportional
// size instead of shrinking to a sliver at 4K.
const TEXT_SCALE = OUTPUT_HEIGHT / 1080;

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

// clipPaths are appended after imagePaths in the final sequence -- guest
// video clips, roast-free (roastLines only ever applies to the photo
// slots), each padded/trimmed to SECONDS_PER_SLOT. Roast-captioned photo
// slots run longer (ROAST_SLOT_SECONDS) so there's time to actually read
// the line -- slot durations aren't uniform, so the crossfade offsets
// below are computed from a running cumulative sum rather than a fixed
// multiple of one constant.
function assembleSlideshow(imagePaths, clipPaths, outputPath, musicPath, roastLines) {
  return new Promise((resolve, reject) => {
    clipPaths = clipPaths || [];
    if ((!imagePaths || imagePaths.length === 0) && clipPaths.length === 0) {
      return reject(new Error("No images or video clips provided for slideshow"));
    }

    const command = ffmpeg();
    const slotCount = imagePaths.length + clipPaths.length;
    const slotDurations = [
      ...imagePaths.map((_, i) => (roastLines && roastLines[i] ? ROAST_SLOT_SECONDS : SECONDS_PER_SLOT)),
      ...clipPaths.map(() => SECONDS_PER_SLOT),
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
      let chain =
        // Event photos are usually portrait, so covering a 1920x1080 frame
        // means cropping content to fill it -- no crop (fixed or biased)
        // can guarantee the whole original photo stays visible. Fit the
        // whole image inside the frame instead (pillarboxed/letterboxed
        // as needed) so nothing from the original is ever cut off. The
        // zoom animation is disabled for the same reason: zoompan here
        // isn't centered (x/y default to 0, anchoring the crop to the
        // top-left), so any zoom > 1 would progressively crop toward the
        // bottom-right over the clip -- a static frame is the only way
        // to keep 100% of the photo visible for the full duration.
        `[${i}:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `zoompan=z=1:d=${Math.round(duration * 25)}:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:fps=25,` +
        `trim=duration=${duration},setpts=PTS-STARTPTS`;

      if (roastLines && roastLines[i]) {
        const textFilePath = path.join(outputDir, `roast-line-${i}.txt`);
        fs.writeFileSync(textFilePath, wrapText(roastLines[i]));
        chain +=
          `,drawtext=fontfile=${fontPath}:textfile=${toFilterPath(textFilePath)}:reload=0:` +
          `fontcolor=white:fontsize=${Math.round(52 * TEXT_SCALE)}:line_spacing=${Math.round(10 * TEXT_SCALE)}:x=(w-text_w)/2:y=h-text_h-${Math.round(70 * TEXT_SCALE)}:` +
          `box=1:boxcolor=black@0.55:boxborderw=${Math.round(24 * TEXT_SCALE)}`;
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
        `[${i}:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,fps=25,` +
        `tpad=stop_mode=clone:stop_duration=${duration},` +
        `trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`
      );
    });

    const zoomFilters = [...photoFilters, ...clipFilters].join(";");

    // xfade's offset is the point in the accumulated stream's own timeline
    // where the next fade begins -- with non-uniform slot durations that's
    // a running total of every preceding slot's duration, minus one
    // TRANSITION_SECONDS per prior transition (each fade overlaps two
    // slots rather than playing them fully back-to-back).
    let concatChain = "";
    let lastLabel = "v0";
    let cumulative = slotDurations[0];
    for (let i = 1; i < slotCount; i++) {
      const outLabel = `vx${i}`;
      const offset = cumulative - i * TRANSITION_SECONDS;
      concatChain += `[${lastLabel}][v${i}]xfade=transition=fade:duration=${TRANSITION_SECONDS}:offset=${offset}[${outLabel}];`;
      lastLabel = outLabel;
      cumulative += slotDurations[i];
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
      .on("start", (cmd) => console.log("FFMPEG COMMAND:", cmd))
      .on("stderr", (line) => console.error("FFMPEG STDERR:", line))
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

module.exports = { assembleSlideshow };