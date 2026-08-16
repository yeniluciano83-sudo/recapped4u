const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
ffmpeg.setFfmpegPath(ffmpegPath);

const SECONDS_PER_PHOTO = 4;
const TRANSITION_SECONDS = 0.6;
const FONT_PATH = path.join(__dirname, "fonts", "Oswald-Bold.ttf");

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

function assembleSlideshow(imagePaths, outputPath, musicPath, roastLines) {
  return new Promise((resolve, reject) => {
    if (!imagePaths || imagePaths.length === 0) {
      return reject(new Error("No images provided for slideshow"));
    }

    const command = ffmpeg();

    // Each image becomes a short clip with a slow zoom (Ken Burns effect).
    // Loop the input indefinitely rather than capping it with an input -t --
    // zoompan doesn't stop emitting frames on its own when fed a continuously
    // looped image, so the actual per-clip duration is enforced below with an
    // explicit trim on the filtered output instead.
    imagePaths.forEach((imgPath) => {
      command.input(imgPath).inputOptions(["-loop", "1"]);
    });

    // Build a filter graph: zoom each image, trim it to its exact duration
    // (zoompan's d= only shapes the zoom curve, it does not terminate the
    // stream), optionally burn on that photo's Roast Reel line, then
    // crossfade-concat the trimmed clips together
    const outputDir = path.dirname(outputPath);
    const fontPath = toFilterPath(FONT_PATH);

    const zoomFilters = imagePaths
      .map((_, i) => {
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
          `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
          `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `zoompan=z=1:d=${Math.round(SECONDS_PER_PHOTO * 25)}:s=1920x1080:fps=25,` +
          `trim=duration=${SECONDS_PER_PHOTO},setpts=PTS-STARTPTS`;

        if (roastLines && roastLines[i]) {
          const textFilePath = path.join(outputDir, `roast-line-${i}.txt`);
          fs.writeFileSync(textFilePath, wrapText(roastLines[i]));
          chain +=
            `,drawtext=fontfile=${fontPath}:textfile=${toFilterPath(textFilePath)}:reload=0:` +
            `fontcolor=white:fontsize=52:line_spacing=10:x=(w-text_w)/2:y=h-text_h-70:` +
            `box=1:boxcolor=black@0.55:boxborderw=24`;
        }

        return chain + `[v${i}]`;
      })
      .join(";");

    let concatChain = "";
    let lastLabel = "v0";
    for (let i = 1; i < imagePaths.length; i++) {
      const outLabel = `vx${i}`;
      const offset = i * SECONDS_PER_PHOTO - i * TRANSITION_SECONDS;
      concatChain += `[${lastLabel}][v${i}]xfade=transition=fade:duration=${TRANSITION_SECONDS}:offset=${offset}[${outLabel}];`;
      lastLabel = outLabel;
    }

    const filterComplex = zoomFilters + (concatChain ? ";" + concatChain.slice(0, -1) : "");

    command
      .complexFilter(filterComplex.replace(/^;/, ""))
      .outputOptions(["-map", `[${lastLabel}]`, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-r", "25"]);

    if (musicPath) {
      const musicInputIndex = imagePaths.length;
      command.input(musicPath).outputOptions(["-map", `${musicInputIndex}:a`, "-shortest", "-c:a", "aac"]);
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