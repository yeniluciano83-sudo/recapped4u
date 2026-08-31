/**
 * One-off setup script -- run this once (locally against the same R2
 * credentials/bucket used in production, and again against production if
 * the credentials differ per environment) before direct-to-R2 uploads work.
 *
 * The guest/host upload pages now PUT photos straight from the browser to
 * R2 using a presigned URL (see app/api/events/[eventId]/upload/presign
 * /route.js), bypassing our own Next.js function entirely. A browser-based
 * cross-origin PUT requires the bucket to explicitly allow it via CORS --
 * without this, every direct upload fails silently with a CORS error the
 * app can't distinguish from a dropped connection.
 *
 *   node scripts/setup-r2-cors.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const { S3Client, PutBucketCorsCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ["https://recappedforyou.com", "https://www.recappedforyou.com", "http://localhost:3000"],
            AllowedMethods: ["PUT"],
            AllowedHeaders: ["content-type"],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    })
  );
  console.log(`CORS configured on bucket "${process.env.R2_BUCKET_NAME}" for PUT from recappedforyou.com and localhost:3000.`);
}

main().catch((err) => {
  console.error("Failed to set R2 bucket CORS:", err);
  process.exit(1);
});
