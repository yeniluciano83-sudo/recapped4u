const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

const SECONDS_PER_PHOTO = 4;
const TRANSITION_SECONDS = 0.6;

function assembleSlideshow(imagePaths, outputPath, musicPath) {
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
    // stream), then crossfade-concat the trimmed clips together
    const zoomFilters = imagePaths
      .map(
        (_, i) =>
          `[${i}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
          `zoompan=z='min(zoom+0.0015,1.15)':d=${Math.round(SECONDS_PER_PHOTO * 25)}:s=1920x1080:fps=25,` +
          `trim=duration=${SECONDS_PER_PHOTO},setpts=PTS-STARTPTS[v${i}]`
      )
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